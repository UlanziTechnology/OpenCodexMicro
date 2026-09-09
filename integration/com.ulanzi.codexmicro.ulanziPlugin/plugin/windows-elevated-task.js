import { Buffer } from "node:buffer";
import { join } from "node:path";

export const WINDOWS_BRIDGE_TASK_NAME = "OpenCodexMicro Codex Bridge";

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function nativeFileAssertions(rootExpression, files) {
  return files.map(file => {
    const relative = String(file.path).replaceAll("/", "\\");
    return `Assert-FileHash (Join-Path ${rootExpression} ${psLiteral(relative)}) ${psLiteral(file.sha256)}`;
  }).join("\n");
}

export function createWindowsElevatedTaskManager({
  execute,
  dataRoot,
  secureRoot,
  bridgePort = 17373,
  taskName = WINDOWS_BRIDGE_TASK_NAME
}) {
  const secureNode = join(secureRoot, "node.exe");
  const secureLauncher = join(secureRoot, "elevated-launcher.mjs");
  const expectedArguments = `"${secureLauncher}" "${dataRoot}"`;

  async function runElevated(script) {
    const systemModuleBootstrap = "$env:PSModulePath=[Environment]::GetEnvironmentVariable('PSModulePath','Machine'); Import-Module Microsoft.PowerShell.Security -ErrorAction Stop";
    const encoded = Buffer.from(`${systemModuleBootstrap}\n${script}`, "utf16le").toString("base64");
    const bootstrap = "$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); if ($isAdmin) { & powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $env:CODEX_BRIDGE_ELEVATED_SCRIPT; exit $LASTEXITCODE }; $p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$env:CODEX_BRIDGE_ELEVATED_SCRIPT); if ($p.ExitCode -ne 0) { exit $p.ExitCode }";
    try {
      await execute("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", bootstrap
      ], {
        timeout: 120000,
        windowsHide: true,
        env: { ...process.env, CODEX_BRIDGE_ELEVATED_SCRIPT: encoded }
      });
    } catch (error) {
      throw new Error(`Administrator approval or elevated Codex Bridge operation failed: ${error.message}`);
    }
  }

  async function status() {
    try {
      const { stdout = "" } = await execute("schtasks.exe", [
        "/Query", "/TN", taskName, "/XML"
      ], {
        timeout: 3000,
        windowsHide: true
      });
      const output = String(stdout);
      const commandMatch = output.match(/<Command>([\s\S]*?)<\/Command>/i);
      const argumentsMatch = output.match(/<Arguments>([\s\S]*?)<\/Arguments>/i);
      const runLevelMatch = output.match(/<RunLevel>([\s\S]*?)<\/RunLevel>/i);
      if (commandMatch && argumentsMatch && runLevelMatch) {
        const command = commandMatch[1].trim();
        const args = argumentsMatch[1].trim();
        const runLevel = runLevelMatch[1].trim();
        const isHighest = /highest/i.test(runLevel);
        return {
          installed: isHighest &&
            command.toLowerCase() === secureNode.toLowerCase() &&
            args.toLowerCase() === expectedArguments.toLowerCase(),
          runLevel: isHighest ? "highest" : null
        };
      }
    } catch {
      // Fall back to PowerShell inspection if schtasks XML query is unsupported or fails
    }
    try {
      const statusScript = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $task = Get-ScheduledTask -TaskName ${psLiteral(taskName)} -ErrorAction Stop; $action = @($task.Actions)[0]; @{ runLevel = [string]$task.Principal.RunLevel; execute = [string]$action.Execute; arguments = [string]$action.Arguments } | ConvertTo-Json -Compress`;
      const { stdout = "" } = await execute("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", statusScript
      ], {
        timeout: 5000,
        windowsHide: true
      });
      const definition = JSON.parse(String(stdout).trim());
      return {
        installed: definition.runLevel === "Highest" &&
          String(definition.execute).toLowerCase() === secureNode.toLowerCase() &&
          String(definition.arguments).toLowerCase() === expectedArguments.toLowerCase(),
        runLevel: definition.runLevel === "Highest" ? "highest" : null
      };
    } catch {
      return { installed: false, runLevel: null };
    }
  }

  async function deploy({
    nodeSource,
    nodeHash,
    launcherSource,
    launcherHash,
    runtimeSource,
    runtimeHash,
    nativeSource,
    nativeRuntimeHash,
    nativeFiles,
    takeOverExistingBridge = false
  }) {
    const runtimeTarget = join(secureRoot, "runtimes", runtimeHash);
    const nativeTarget = join(secureRoot, "native-runtimes", nativeRuntimeHash);
    const script = `$ErrorActionPreference = 'Stop'
$secureRoot = ${psLiteral(secureRoot)}
$nodeSource = ${psLiteral(nodeSource)}
$launcherSource = ${psLiteral(launcherSource)}
$runtimeSource = ${psLiteral(runtimeSource)}
$nativeSource = ${psLiteral(nativeSource)}
$runtimeTarget = ${psLiteral(runtimeTarget)}
$nativeTarget = ${psLiteral(nativeTarget)}
$nodeTarget = ${psLiteral(secureNode)}
$launcherTarget = ${psLiteral(secureLauncher)}
${takeOverExistingBridge ? `$listenerPids = @(Get-NetTCPConnection -LocalPort ${Number(bridgePort)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($listenerPid in $listenerPids) {
  $listenerProcess = Get-Process -Id $listenerPid -ErrorAction Stop
  if ($listenerProcess.ProcessName -notlike 'node*') { throw 'The Codex Bridge port is owned by an unexpected process.' }
  Stop-Process -Id $listenerPid -Force -ErrorAction Stop
  Wait-Process -Id $listenerPid -Timeout 5 -ErrorAction SilentlyContinue
}
$remainingListener = @(Get-NetTCPConnection -LocalPort ${Number(bridgePort)} -State Listen -ErrorAction SilentlyContinue)
if ($remainingListener.Count -gt 0) { throw 'The existing Codex Bridge listener could not be stopped.' }` : ""}
function Assert-FileHash([string]$Path, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing protected Bridge source file." }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) { throw "Protected Bridge source hash verification failed." }
}
Assert-FileHash $nodeSource ${psLiteral(nodeHash)}
Assert-FileHash $launcherSource ${psLiteral(launcherHash)}
Assert-FileHash $runtimeSource ${psLiteral(runtimeHash)}
${nativeFileAssertions("$nativeSource", nativeFiles)}
New-Item -ItemType Directory -Path $runtimeTarget -Force | Out-Null
New-Item -ItemType Directory -Path $nativeTarget -Force | Out-Null
Copy-Item -LiteralPath $nodeSource -Destination $nodeTarget -Force
Copy-Item -LiteralPath $launcherSource -Destination $launcherTarget -Force
Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $runtimeTarget 'bridge.mjs') -Force
Copy-Item -Path (Join-Path $nativeSource '*') -Destination $nativeTarget -Recurse -Force
Assert-FileHash $nodeTarget ${psLiteral(nodeHash)}
Assert-FileHash $launcherTarget ${psLiteral(launcherHash)}
Assert-FileHash (Join-Path $runtimeTarget 'bridge.mjs') ${psLiteral(runtimeHash)}
${nativeFileAssertions("$nativeTarget", nativeFiles)}
$nodeVersion = (& $nodeTarget --version 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v?(2[0-9]|[3-9][0-9])\\.') { throw 'The protected Node.js runtime is not compatible.' }
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
function Protect-BridgeItem([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  $isDirectory = $item.PSIsContainer
  $acl = if ($isDirectory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($administrators)
  $inherit = if ($isDirectory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($administrators, 'FullControl', $inherit, $propagation, $allow))
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($system, 'FullControl', $inherit, $propagation, $allow))
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($currentUser, 'ReadAndExecute', $inherit, $propagation, $allow))
  Set-Acl -LiteralPath $Path -AclObject $acl
}
Protect-BridgeItem $secureRoot
Get-ChildItem -LiteralPath $secureRoot -Recurse -Force | ForEach-Object { Protect-BridgeItem $_.FullName }
$action = New-ScheduledTaskAction -Execute $nodeTarget -Argument (${psLiteral(`"${secureLauncher}" "${dataRoot}"`)}) -WorkingDirectory $secureRoot
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName ${psLiteral(taskName)} -Action $action -Principal $principal -Settings $settings -Force | Out-Null
`;
    await runElevated(script);
  }

  async function start() {
    await execute("schtasks.exe", ["/Run", "/TN", taskName], { timeout: 5000, windowsHide: true });
  }

  async function stop() {
    try {
      await execute("schtasks.exe", ["/End", "/TN", taskName], { timeout: 7000, windowsHide: true });
    } catch {
      // A stopped or absent task is handled by the caller's loopback health verification.
    }
  }

  async function uninstall() {
    const script = `$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName ${psLiteral(taskName)} -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -InputObject $task -Confirm:$false }
if (Test-Path -LiteralPath ${psLiteral(secureRoot)}) { Remove-Item -LiteralPath ${psLiteral(secureRoot)} -Recurse -Force }
`;
    await runElevated(script);
  }

  return { status, deploy, start, stop, uninstall, taskName, secureRoot, secureNode, secureLauncher };
}
