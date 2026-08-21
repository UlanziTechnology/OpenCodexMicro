import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CDP_HOST = "127.0.0.1";
export const DEFAULT_CDP_PORT = 9222;
export const CDP_ARGUMENTS = Object.freeze([
  `--remote-debugging-address=${CDP_HOST}`,
  `--remote-debugging-port=${DEFAULT_CDP_PORT}`,
  `--remote-allow-origins=http://${CDP_HOST}:${DEFAULT_CDP_PORT}`
]);

const WINDOWS_PROCESS_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$listenerOwners = @{}
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
  ForEach-Object { $listenerOwners[('{0}:{1}' -f $_.LocalPort, $_.OwningProcess)] = $true }
$rows = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*--remote-debugging-address=127.0.0.1*' } |
  ForEach-Object {
    $portMatch = [regex]::Match([string]$_.CommandLine, '--remote-debugging-port(?:=|\s+)(\d+)')
    $debugPort = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 0 }
    [pscustomobject]@{
      processId = [int]$_.ProcessId
      executable = [string]$_.ExecutablePath
      commandLine = [string]$_.CommandLine
      ownsDebugPort = $debugPort -gt 0 -and $listenerOwners.ContainsKey(('{0}:{1}' -f $debugPort, $_.ProcessId))
    }
  }
@($rows) | ConvertTo-Json -Compress
`;

const WINDOWS_PACKAGE_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$rows = foreach ($name in @('OpenAI.Codex', 'OpenAI.CodexBeta')) {
  $package = Get-AppxPackage -Name $name | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $package) { continue }
  $app = Join-Path $package.InstallLocation 'app'
  $names = if ($name -eq 'OpenAI.CodexBeta') {
    @('ChatGPT (Beta).exe', 'Codex (Beta).exe', 'ChatGPT.exe')
  } else {
    @('ChatGPT.exe', 'Codex.exe')
  }
  foreach ($file in $names) {
    $candidate = Join-Path $app $file
    if (Test-Path -LiteralPath $candidate) {
      [pscustomobject]@{
        channel = if ($name -eq 'OpenAI.CodexBeta') { 'beta' } else { 'stable' }
        packageName = $name
        packageFullName = $package.PackageFullName
        executable = $candidate
      }
      break
    }
  }
}
@($rows) | ConvertTo-Json -Compress
`;

const WINDOWS_STOP_EXECUTABLE_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:CODEX_BRIDGE_TARGET_EXECUTABLE
$processes = @(Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -eq $target -and
    $_.CommandLine -notlike '*--type=*' -and
    $_.CommandLine -notlike '*crashpad-handler*'
  })
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -ErrorAction Stop }
foreach ($process in $processes) { Wait-Process -Id $process.ProcessId -Timeout 8 -ErrorAction SilentlyContinue }
`;

function powershellArgs(command, extra = []) {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    command,
    ...extra
  ];
}

function powershellOptions(options = {}) {
  return { ...options, windowsHide: true };
}

export function debugPortsFromCommandLines(text) {
  return [...new Set(debugProcessesFromCommandLines(text).map(item => item.port))];
}

function processChannel(executable, commandLine) {
  const identity = `${executable || ""} ${commandLine || ""}`.toLowerCase();
  return /codexbeta|chatgpt\s*\(beta\)|codex\s*\(beta\)/.test(identity) ? "beta" : "stable";
}

export function debugProcessesFromCommandLines(text) {
  const source = String(text || "").trim();
  let rows = [];
  if (source.startsWith("[") || source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
  }
  if (rows.length === 0) {
    rows = source.split(/\r?\n/).filter(Boolean).map(commandLine => ({ commandLine }));
  }
  return rows.flatMap(row => {
    const commandLine = String(row?.commandLine || "");
    if (!commandLine.includes("--remote-debugging-address=127.0.0.1")) return [];
    if (commandLine.includes("--type=")) return [];
    const port = Number(commandLine.match(/--remote-debugging-port(?:=|\s+)(\d+)/)?.[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
    const processId = Number(row?.processId);
    const executable = typeof row?.executable === "string" ? row.executable : null;
    return [{
      port,
      processId: Number.isInteger(processId) && processId > 0 ? processId : null,
      executable,
      channel: processChannel(executable, commandLine),
      ownsDebugPort: row?.ownsDebugPort === true
    }];
  });
}

export async function fetchJson(url, timeout = 1200, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function processCommandLines(platform, execute) {
  if (platform === "win32") {
    return (await execute(
      "powershell.exe",
      powershellArgs(WINDOWS_PROCESS_COMMAND),
      powershellOptions({ timeout: 4000 })
    )).stdout;
  }
  if (platform === "darwin") {
    return (await execute("/bin/ps", ["-axo", "command="], { timeout: 4000 })).stdout;
  }
  return "";
}

export async function discoverDebugEndpoint({
  platform = process.platform,
  execute = execFileAsync,
  fetchImpl = fetch,
  preferredPort = DEFAULT_CDP_PORT
} = {}) {
  let processes = [];
  try {
    processes = debugProcessesFromCommandLines(await processCommandLines(platform, execute));
  } catch {
    // Direct loopback probing remains available when process inspection is denied.
  }
  const candidates = [preferredPort, ...processes.map(item => item.port)];
  for (const port of [...new Set(candidates)]) {
    try {
      await fetchJson(`http://${CDP_HOST}:${port}/json/version`, 500, fetchImpl);
      const process = processes.find(item => item.port === port && item.ownsDebugPort)
        ?? processes.find(item => item.port === port);
      return {
        port,
        processId: process?.processId ?? null,
        executable: process?.executable ?? null,
        channel: process?.channel ?? null
      };
    } catch {}
  }
  throw new Error("Codex is not running with the local debug bridge");
}

export async function discoverDebugPort(options = {}) {
  return (await discoverDebugEndpoint(options)).port;
}

export async function discoverWindowsCodexExecutables({ execute = execFileAsync } = {}) {
  const { stdout = "" } = await execute(
    "powershell.exe",
    powershellArgs(WINDOWS_PACKAGE_COMMAND),
    powershellOptions({ timeout: 8000 })
  );
  if (!String(stdout).trim()) return [];
  const parsed = JSON.parse(String(stdout));
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter((row) =>
    ["stable", "beta"].includes(row?.channel) &&
    typeof row?.executable === "string" && row.executable.toLowerCase().endsWith(".exe")
  );
}

export async function focusCodex({
  platform = process.platform,
  execute = execFileAsync,
  processId = null,
  activateWindows = null
} = {}) {
  if (platform === "win32") {
    const activate = activateWindows
      ?? (await import("./windows-focus.mjs")).activateWindowsProcess;
    return activate(processId);
  }
  if (platform === "darwin") {
    await execute("/usr/bin/open", ["-b", "com.openai.codex"], { timeout: 3000 });
    return;
  }
  throw new Error(`Codex Desktop focus is not supported on ${platform}`);
}

export async function launchWindowsCodex({
  channel = "stable",
  execute = execFileAsync,
  spawnProcess = spawn
} = {}) {
  const installations = await discoverWindowsCodexExecutables({ execute });
  const selected = installations.find((item) => item.channel === channel)
    ?? installations.find((item) => item.channel === "stable")
    ?? installations[0];
  if (!selected) {
    throw new Error("Codex Desktop Stable or Beta was not found in the current Windows account.");
  }
  await execute(
    "powershell.exe",
    powershellArgs(WINDOWS_STOP_EXECUTABLE_COMMAND),
    powershellOptions({
      timeout: 10000,
      env: { ...process.env, CODEX_BRIDGE_TARGET_EXECUTABLE: selected.executable }
    })
  );
  const child = spawnProcess(selected.executable, [...CDP_ARGUMENTS], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref?.();
  return selected;
}
