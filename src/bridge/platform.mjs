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
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*--remote-debugging-address=127.0.0.1*' } |
  ForEach-Object { $_.CommandLine }
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

const WINDOWS_FOCUS_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CodexWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$debugPids = @(Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*--remote-debugging-address=127.0.0.1*' -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object -ExpandProperty ProcessId)
$candidate = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like 'ChatGPT*' -or $_.ProcessName -like 'Codex*') } |
  Sort-Object @{ Expression = { if ($debugPids -contains $_.Id) { 0 } else { 1 } } }, StartTime |
  Select-Object -First 1
if (-not $candidate) { throw 'A Codex Desktop window was not found.' }
[CodexWindow]::ShowWindowAsync($candidate.MainWindowHandle, 9) | Out-Null
if (-not [CodexWindow]::SetForegroundWindow($candidate.MainWindowHandle)) {
  $shell = New-Object -ComObject WScript.Shell
  if (-not $shell.AppActivate($candidate.Id)) {
    throw 'Windows did not allow Codex Desktop to receive focus.'
  }
}
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
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command, ...extra];
}

export function debugPortsFromCommandLines(text) {
  const ports = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.includes("--remote-debugging-address=127.0.0.1")) continue;
    const port = Number(line.match(/--remote-debugging-port(?:=|\s+)(\d+)/)?.[1]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) ports.push(port);
  }
  return [...new Set(ports)];
}

export async function fetchJson(url, timeout = 1200, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function processCommandLines(platform, execute) {
  if (platform === "win32") {
    return (await execute("powershell.exe", powershellArgs(WINDOWS_PROCESS_COMMAND), { timeout: 4000 })).stdout;
  }
  if (platform === "darwin") {
    return (await execute("/bin/ps", ["-axo", "command="], { timeout: 4000 })).stdout;
  }
  return "";
}

export async function discoverDebugPort({
  platform = process.platform,
  execute = execFileAsync,
  fetchImpl = fetch,
  preferredPort = DEFAULT_CDP_PORT
} = {}) {
  try {
    await fetchJson(`http://${CDP_HOST}:${preferredPort}/json/version`, 500, fetchImpl);
    return preferredPort;
  } catch {}
  const candidates = [];
  try {
    candidates.push(...debugPortsFromCommandLines(await processCommandLines(platform, execute)));
  } catch {
    // Direct loopback probing remains available when process inspection is denied.
  }
  for (const port of [...new Set(candidates)].filter((port) => port !== preferredPort)) {
    try {
      await fetchJson(`http://${CDP_HOST}:${port}/json/version`, 500, fetchImpl);
      return port;
    } catch {}
  }
  throw new Error("Codex is not running with the local debug bridge");
}

export async function discoverWindowsCodexExecutables({ execute = execFileAsync } = {}) {
  const { stdout = "" } = await execute(
    "powershell.exe",
    powershellArgs(WINDOWS_PACKAGE_COMMAND),
    { timeout: 8000 }
  );
  if (!String(stdout).trim()) return [];
  const parsed = JSON.parse(String(stdout));
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter((row) =>
    ["stable", "beta"].includes(row?.channel) &&
    typeof row?.executable === "string" && row.executable.toLowerCase().endsWith(".exe")
  );
}

export async function focusCodex({ platform = process.platform, execute = execFileAsync } = {}) {
  if (platform === "win32") {
    await execute("powershell.exe", powershellArgs(WINDOWS_FOCUS_COMMAND), { timeout: 5000 });
    return;
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
    {
      timeout: 10000,
      env: { ...process.env, CODEX_BRIDGE_TARGET_EXECUTABLE: selected.executable }
    }
  );
  const child = spawnProcess(selected.executable, [...CDP_ARGUMENTS], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref?.();
  return selected;
}
