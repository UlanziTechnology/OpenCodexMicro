import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import {
  discoverDebugPort,
  focusCodex,
  launchWindowsCodex
} from "../../../src/bridge/platform.mjs";

const execFileAsync = promisify(execFile);

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function exists(path, mode = fsConstants.F_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function fileSha256(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireFilesystemLock({
  lockPath,
  timeoutMs = 15000,
  staleMs = 300000,
  wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
  const ownerToken = randomBytes(24).toString("base64url");
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({
        pid: process.pid,
        ownerToken,
        createdAt: new Date().toISOString()
      })}\n`);
      return async () => {
        const owner = await readJson(join(lockPath, "owner.json"));
        if (owner?.ownerToken === ownerToken) {
          await rm(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const [lockInfo, owner] = await Promise.all([
        stat(lockPath).catch(() => null),
        readJson(join(lockPath, "owner.json"))
      ]);
      if (lockInfo && Date.now() - lockInfo.mtimeMs > staleMs && !processIsAlive(Number(owner?.pid))) {
        const abandonedLock = `${lockPath}.abandoned-${process.pid}-${ownerToken}`;
        try {
          await rename(lockPath, abandonedLock);
          await rm(abandonedLock, { recursive: true, force: true });
        } catch (recoveryError) {
          if (!await exists(lockPath)) continue;
          if (!["ENOENT", "EEXIST", "EPERM", "EACCES"].includes(recoveryError?.code)) throw recoveryError;
        }
        continue;
      }
      await wait(100);
    }
  }
  throw new Error("Another lifecycle operation is still running.");
}

async function nodeVersion(executable, execute) {
  try {
    const { stdout = "" } = await execute(executable, ["--version"]);
    const match = String(stdout).trim().match(/^v?(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    return { text: String(stdout).trim().replace(/^v/, ""), major: Number(match[1]) };
  } catch {
    return null;
  }
}

export function bridgeDataRoot({
  platform = process.platform,
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA
} = {}) {
  if (platform === "win32") {
    return join(localAppData || join(home, "AppData", "Local"), "OpenCodexMicro");
  }
  return join(home, "Library", "Application Support", "OpenCodexMicro");
}

export async function selectBridgeNodeRuntime({
  home = homedir(),
  fallbackNodeExecutable = process.execPath,
  environmentPath = process.env.PATH || "",
  platform = process.platform,
  execute = execFileAsync
} = {}) {
  const candidates = [];
  if (platform === "darwin" && await exists("/bin/zsh", fsConstants.X_OK)) {
    try {
      const { stdout = "" } = await execute("/bin/zsh", ["-lic", "node -p process.execPath"]);
      const discovered = String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("/") && line.split("/").at(-1) === "node");
      if (discovered) candidates.push(await realpath(discovered));
    } catch {
      // Login-shell discovery is best effort; PATH and fallback remain.
    }
  }
  const nodeName = platform === "win32" ? "node.exe" : "node";
  for (const directory of environmentPath.split(delimiter).filter(Boolean)) {
    candidates.push(join(directory, nodeName));
  }
  if (platform === "darwin") {
    candidates.push(
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      join(home, ".local", "bin", "node")
    );
  }

  let resolvedFallback = fallbackNodeExecutable;
  try {
    resolvedFallback = await realpath(fallbackNodeExecutable);
  } catch {
    // The fallback availability check below provides the final result.
  }
  for (const executable of [...new Set(candidates)]) {
    if (!isAbsolute(executable)) continue;
    if (!await exists(executable, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK)) continue;
    const resolvedExecutable = await realpath(executable);
    if (resolvedExecutable === resolvedFallback) continue;
    const candidateVersion = await nodeVersion(resolvedExecutable, execute);
    if (candidateVersion?.major >= 20) {
      return { executable: resolvedExecutable, version: candidateVersion.text, source: "system" };
    }
  }

  if (await exists(resolvedFallback, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK)) {
    const fallbackVersion = await nodeVersion(resolvedFallback, execute);
    if (fallbackVersion?.major >= 20) {
      return { executable: resolvedFallback, version: fallbackVersion.text, source: "ulanzi" };
    }
  }
  throw new Error("No compatible Node.js 20 or later runtime was found.");
}

export function createBridgeInstaller({
  pluginRoot,
  bridgeUrl,
  version,
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA,
  uid = process.getuid?.(),
  platform = process.platform,
  nodeExecutable = process.execPath,
  environmentPath = process.env.PATH || "",
  codexChannel = process.env.CODEX_DESKTOP_CHANNEL || "stable",
  execute = execFileAsync,
  spawnProcess = spawn,
  fetchImpl = fetch,
  serviceStartTimeoutMs = 8000,
  wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
  const appRoot = bridgeDataRoot({ platform, home, localAppData });
  const bridgeRuntime = join(appRoot, "bridge.mjs");
  const tokenPath = join(appRoot, "bridge-token");
  const pidPath = join(appRoot, "bridge.pid");
  const installMetadata = join(appRoot, "install.json");
  const lifecycleLock = join(dirname(appRoot), ".OpenCodexMicro.lifecycle.lock");
  const installerRoot = resolve(pluginRoot, "installer");
  const bundledRuntime = join(installerRoot, "bridge.mjs");
  const bundledIcon = join(installerRoot, "CodexBridge.png");
  const runtimeBackup = join(appRoot, ".bridge.mjs.previous");
  const metadataBackup = join(appRoot, ".install.json.previous");

  const userApplications = join(home, "Applications");
  const bridgeApp = join(userApplications, "Codex Bridge.app");
  const bridgeContents = join(bridgeApp, "Contents");
  const bridgeMacOS = join(bridgeContents, "MacOS");
  const bridgeResources = join(bridgeContents, "Resources");
  const bridgeLicenses = join(bridgeResources, "licenses");
  const bridgeExecutable = join(bridgeMacOS, "Codex Bridge");
  const bridgeIcon = join(bridgeResources, "CodexBridge.icns");
  const agentsRoot = join(home, "Library", "LaunchAgents");
  const bridgeAgent = join(agentsRoot, "io.opencodexmicro.bridge.plist");
  let lastWindowsServiceStart = 0;
  let authorizationCache = null;
  let authorizationPromise = null;
  let authorizationGeneration = 0;
  let lifecycleOperation = null;

  function resetAuthorizationCache() {
    authorizationGeneration += 1;
    authorizationCache = null;
    authorizationPromise = null;
  }

  async function authorizationHeaders() {
    if (authorizationCache) return authorizationCache;
    if (authorizationPromise) return authorizationPromise;
    const generation = authorizationGeneration;
    const operation = (async () => {
      try {
        const token = (await readFile(tokenPath, "utf8")).trim();
        const headers = token ? Object.freeze({ Authorization: `Bearer ${token}` }) : {};
        if (token && generation === authorizationGeneration) authorizationCache = headers;
        return headers;
      } catch {
        return {};
      }
    })();
    authorizationPromise = operation;
    try {
      return await operation;
    } finally {
      if (authorizationPromise === operation) authorizationPromise = null;
    }
  }

  async function probeBridge() {
    try {
      const response = await fetchImpl(`${bridgeUrl}/health`, {
        headers: await authorizationHeaders(),
        signal: AbortSignal.timeout(1200)
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Bridge HTTP ${response.status}`);
      return {
        serviceOnline: true,
        cdpConnected: Boolean(payload.codexConnected),
        serviceVersion: typeof payload.bridgeVersion === "string" ? payload.bridgeVersion : null,
        serviceRuntimeHash: typeof payload.runtimeHash === "string" ? payload.runtimeHash : null,
        serviceError: null
      };
    } catch (error) {
      return {
        serviceOnline: false,
        cdpConnected: false,
        serviceVersion: null,
        serviceRuntimeHash: null,
        serviceError: error.message
      };
    }
  }

  async function status() {
    const [runtimeInstalled, tokenInstalled, metadata, probe, bundledRuntimeHash, installedRuntimeHash] = await Promise.all([
      exists(bridgeRuntime),
      exists(tokenPath),
      readJson(installMetadata),
      probeBridge(),
      fileSha256(bundledRuntime),
      fileSha256(bridgeRuntime)
    ]);
    const macAppInstalled = platform === "darwin"
      ? await exists(bridgeExecutable, fsConstants.X_OK)
      : runtimeInstalled;
    const agentInstalled = platform === "darwin" ? await exists(bridgeAgent) : true;
    const installed = macAppInstalled && runtimeInstalled && tokenInstalled && agentInstalled;
    const installationDetected = Boolean(
      runtimeInstalled || tokenInstalled || metadata || probe.serviceOnline ||
      (platform === "darwin" && (macAppInstalled || agentInstalled))
    );
    const metadataMatchesBundle = Boolean(
      bundledRuntimeHash &&
      metadata?.version === version &&
      metadata?.runtimeHash === bundledRuntimeHash &&
      installedRuntimeHash === bundledRuntimeHash
    );
    const runningMatchesBundle = !probe.serviceOnline || Boolean(
      bundledRuntimeHash &&
      probe.serviceVersion === version &&
      probe.serviceRuntimeHash === bundledRuntimeHash
    );
    return {
      supported: platform === "win32" || (platform === "darwin" && Number.isInteger(uid)),
      platform,
      installed,
      installationDetected,
      appInstalled: macAppInstalled,
      serviceInstalled: runtimeInstalled && tokenInstalled && agentInstalled,
      installedVersion: metadata?.version || null,
      bundledVersion: version,
      bundledRuntimeHash,
      installedRuntimeHash,
      needsUpdate: !installed || !metadataMatchesBundle || !runningMatchesBundle,
      appPath: platform === "darwin" ? bridgeApp : appRoot,
      nodeExecutable: metadata?.nodeExecutable || null,
      nodeVersion: metadata?.nodeVersion || null,
      nodeSource: metadata?.nodeSource || null,
      codexChannel: metadata?.codexChannel || codexChannel,
      ...probe
    };
  }

  async function buildMacIcon() {
    const iconset = join(appRoot, "CodexBridge.iconset");
    await rm(iconset, { recursive: true, force: true });
    await mkdir(iconset, { recursive: true });
    try {
      for (const [name, size] of [
        ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
        ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
        ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
        ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
        ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024]
      ]) {
        await execute("/usr/bin/sips", ["-z", String(size), String(size), bundledIcon, "--out", join(iconset, name)]);
      }
      await execute("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", bridgeIcon]);
    } finally {
      await rm(iconset, { recursive: true, force: true });
    }
  }

  async function installMac(nodeRuntime, appVersion = version) {
    await mkdir(userApplications, { recursive: true });
    await mkdir(agentsRoot, { recursive: true });
    await rm(bridgeApp, { recursive: true, force: true });
    await mkdir(bridgeMacOS, { recursive: true });
    await mkdir(bridgeLicenses, { recursive: true });
    for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
      await copyFile(join(installerRoot, notice), join(bridgeLicenses, notice));
    }
    await buildMacIcon();
    await writeFile(join(bridgeContents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Codex Bridge</string>
  <key>CFBundleExecutable</key><string>Codex Bridge</string>
  <key>CFBundleIconFile</key><string>CodexBridge</string>
  <key>CFBundleIdentifier</key><string>io.opencodexmicro.bridge</string>
  <key>CFBundleName</key><string>Codex Bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(appVersion)}</string>
  <key>CFBundleVersion</key><string>${xml(appVersion)}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);
    await writeFile(bridgeExecutable, `#!/bin/zsh
set -u
codex_binary="/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
if [[ ! -x "$codex_binary" ]]; then exit 1; fi
if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then
  /usr/bin/osascript -e 'tell application id "com.openai.codex" to quit'
  for attempt in {1..80}; do /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1 || break; /bin/sleep 0.1; done
fi
if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then exit 1; fi
/usr/bin/nohup "$codex_binary" ${
  ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222", "--remote-allow-origins=http://127.0.0.1:9222"].join(" ")
} >/dev/null 2>&1 &
`, { mode: 0o755 });
    await chmod(bridgeExecutable, 0o755);
    await execute("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bridgeApp]);
    await writeFile(bridgeAgent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.opencodexmicro.bridge</string>
  <key>ProgramArguments</key><array><string>${xml(nodeRuntime.executable)}</string><string>${xml(bridgeRuntime)}</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>CODEX_BRIDGE_DATA_ROOT</key><string>${xml(appRoot)}</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml(join(appRoot, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(appRoot, "bridge-error.log"))}</string>
</dict></plist>
`, { mode: 0o644 });
    await execute("/bin/launchctl", ["bootstrap", `gui/${uid}`, bridgeAgent]);
  }

  async function acquireLifecycleLock() {
    await mkdir(appRoot, { recursive: true, mode: 0o700 });
    return acquireFilesystemLock({ lockPath: lifecycleLock, wait });
  }

  function serializeLifecycle(operation) {
    if (lifecycleOperation) return lifecycleOperation;
    const running = (async () => {
      const release = await acquireLifecycleLock();
      try {
        if (!await exists(bridgeRuntime) && await exists(runtimeBackup)) {
          await rename(runtimeBackup, bridgeRuntime);
        }
        if (!await exists(installMetadata) && await exists(metadataBackup)) {
          await rename(metadataBackup, installMetadata);
        }
        return await operation();
      } finally {
        await release();
      }
    })();
    lifecycleOperation = running;
    return running.finally(() => {
      if (lifecycleOperation === running) lifecycleOperation = null;
    });
  }

  async function stopWindowsService() {
    const recordedPid = Number((await readFile(pidPath, "utf8").catch(() => "")).trim());
    const stopScript = "$target=$env:CODEX_BRIDGE_TARGET_RUNTIME; $targetPid=0; [void][int]::TryParse($env:CODEX_BRIDGE_TARGET_PID, [ref]$targetPid); $candidates=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -like 'node*' -and $_.CommandLine -and ($_.CommandLine.TrimEnd().EndsWith($target, [System.StringComparison]::OrdinalIgnoreCase) -or $_.CommandLine.TrimEnd().EndsWith(('\"' + $target + '\"'), [System.StringComparison]::OrdinalIgnoreCase)) }); $processes=if ($targetPid -gt 0) { @($candidates | Where-Object { $_.ProcessId -eq $targetPid }) } else { $candidates }; $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $processes | ForEach-Object { try { Wait-Process -Id $_.ProcessId -Timeout 5 -ErrorAction Stop } catch {} }";
    await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", stopScript], {
      timeout: 7000,
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_BRIDGE_TARGET_RUNTIME: bridgeRuntime,
        CODEX_BRIDGE_TARGET_PID: Number.isInteger(recordedPid) && recordedPid > 0 ? String(recordedPid) : ""
      }
    });
    await rm(pidPath, { force: true });
    lastWindowsServiceStart = 0;
  }

  async function waitForServiceOffline() {
    const deadline = Date.now() + Math.min(serviceStartTimeoutMs, 5000);
    do {
      if (!(await probeBridge()).serviceOnline) return;
      await wait(100);
    } while (Date.now() < deadline);
    throw new Error("The managed Codex Bridge process did not stop before replacement.");
  }

  async function stopService() {
    if (platform === "darwin") {
      const wasOnline = (await probeBridge()).serviceOnline;
      if (await exists(bridgeAgent)) {
        try {
          await execute("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent]);
        } catch (error) {
          if (wasOnline) throw new Error(`Codex Bridge LaunchAgent could not be stopped: ${error.message}`);
        }
      }
      if (wasOnline) await waitForServiceOffline();
      return;
    }
    if (platform === "win32") await stopWindowsService();
  }

  async function commitRuntime(stagedRuntime) {
    await rm(runtimeBackup, { force: true });
    if (await exists(bridgeRuntime)) await rename(bridgeRuntime, runtimeBackup);
    try {
      await rename(stagedRuntime, bridgeRuntime);
    } catch (error) {
      if (!await exists(bridgeRuntime) && await exists(runtimeBackup)) {
        await rename(runtimeBackup, bridgeRuntime);
      }
      throw error;
    }
  }

  async function restorePreviousRuntime(previousRuntime) {
    await rm(bridgeRuntime, { force: true });
    if (await exists(runtimeBackup)) {
      await rename(runtimeBackup, bridgeRuntime);
      return;
    }
    if (previousRuntime) {
      const rollbackRuntime = join(appRoot, `.bridge.mjs.rollback-${process.pid}`);
      await writeFile(rollbackRuntime, previousRuntime);
      await rename(rollbackRuntime, bridgeRuntime);
    }
  }

  async function commitMetadata(metadataText) {
    const stagedMetadata = join(appRoot, `.install.json.installing-${process.pid}`);
    await writeFile(stagedMetadata, metadataText, { mode: 0o600 });
    await rm(metadataBackup, { force: true });
    if (await exists(installMetadata)) await rename(installMetadata, metadataBackup);
    try {
      await rename(stagedMetadata, installMetadata);
    } catch (error) {
      if (!await exists(installMetadata) && await exists(metadataBackup)) {
        await rename(metadataBackup, installMetadata);
      }
      throw error;
    }
  }

  async function restorePreviousMetadata(previousMetadataText, useBackup = true) {
    await rm(installMetadata, { force: true });
    if (useBackup && await exists(metadataBackup)) {
      await rename(metadataBackup, installMetadata);
      return;
    }
    await rm(metadataBackup, { force: true });
    if (previousMetadataText) {
      await writeFile(installMetadata, previousMetadataText, { mode: 0o600 });
    }
  }

  async function discardTransactionBackups() {
    await Promise.all([
      rm(runtimeBackup, { force: true }),
      rm(metadataBackup, { force: true })
    ]);
  }

  async function startInstalledService(metadata) {
    if (!metadata?.nodeExecutable) {
      throw new Error("Codex Bridge runtime metadata is missing its Node.js executable.");
    }
    if (platform === "darwin") {
      await installMac({
        executable: metadata.nodeExecutable,
        version: metadata.nodeVersion || "unknown",
        source: metadata.nodeSource || "unknown"
      }, metadata.version || "0.0.0");
    }
    if (platform === "win32") await ensureServiceUnlocked();
  }

  async function waitForAnyService() {
    const deadline = Date.now() + serviceStartTimeoutMs;
    do {
      const probe = await probeBridge();
      if (probe.serviceOnline) return probe;
      await wait(100);
    } while (Date.now() < deadline);
    throw new Error("The restored Codex Bridge service did not become reachable.");
  }

  async function rollbackInterruptedUpdate() {
    const hasRuntimeBackup = await exists(runtimeBackup);
    const hasMetadataBackup = await exists(metadataBackup);
    if (!hasRuntimeBackup && !hasMetadataBackup) return false;
    await stopService();
    if (hasRuntimeBackup) {
      await rm(bridgeRuntime, { force: true });
      await rename(runtimeBackup, bridgeRuntime);
    }
    if (hasMetadataBackup) {
      await rm(installMetadata, { force: true });
      await rename(metadataBackup, installMetadata);
    }
    resetAuthorizationCache();
    const restoredMetadata = await readJson(installMetadata);
    await startInstalledService(restoredMetadata);
    await waitForAnyService();
    return true;
  }

  async function waitForExpectedService(expectedRuntimeHash, expectedVersion = version) {
    const deadline = Date.now() + serviceStartTimeoutMs;
    let lastProbe = null;
    do {
      lastProbe = await probeBridge();
      if (
        lastProbe.serviceOnline &&
        lastProbe.serviceVersion === expectedVersion &&
        lastProbe.serviceRuntimeHash === expectedRuntimeHash
      ) {
        return lastProbe;
      }
      await wait(100);
    } while (Date.now() < deadline);
    const detail = lastProbe?.serviceOnline
      ? "the running process reported a different build"
      : "the restarted service did not become reachable";
    throw new Error(`Codex Bridge ${expectedVersion} restart failed: ${detail}.`);
  }

  async function installUnlocked() {
    if (!(platform === "win32" || (platform === "darwin" && Number.isInteger(uid)))) {
      throw new Error("Codex Bridge installation is supported on Windows and macOS only.");
    }
    if (!await exists(bundledRuntime) || !await exists(bundledIcon)) {
      throw new Error("The plugin does not contain the Codex Bridge installation resources.");
    }
    const nodeRuntime = await selectBridgeNodeRuntime({
      home,
      fallbackNodeExecutable: nodeExecutable,
      environmentPath,
      platform,
      execute
    });
    const previousStatus = await status();
    const previousRuntime = await readFile(bridgeRuntime).catch(() => null);
    const previousRuntimeHash = previousRuntime
      ? createHash("sha256").update(previousRuntime).digest("hex")
      : null;
    const previousMetadataText = await readFile(installMetadata, "utf8").catch(() => null);
    const previousMetadata = await readJson(installMetadata);
    const stagedRuntime = join(appRoot, `.bridge.mjs.installing-${process.pid}`);
    await mkdir(appRoot, { recursive: true, mode: 0o700 });
    if (platform !== "win32") await chmod(appRoot, 0o700);
    await rm(stagedRuntime, { force: true });
    await copyFile(bundledRuntime, stagedRuntime);
    const runtimeHash = await fileSha256(stagedRuntime);
    if (!runtimeHash) throw new Error("The bundled Codex Bridge runtime could not be verified.");

    console.log(`[Codex Bridge] ${previousStatus.installed ? "Updating" : "Installing"} ${version}; stopping only the managed Bridge process.`);
    try {
      await stopService();
      await commitRuntime(stagedRuntime);
      for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
        await copyFile(join(installerRoot, notice), join(appRoot, notice));
      }
      if (!await exists(tokenPath)) {
        await writeFile(tokenPath, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
      }
      resetAuthorizationCache();
      await commitMetadata(`${JSON.stringify({
        version,
        runtimeHash,
        platform,
        codexChannel,
        nodeExecutable: nodeRuntime.executable,
        nodeVersion: nodeRuntime.version,
        nodeSource: nodeRuntime.source,
        installedAt: new Date().toISOString()
      }, null, 2)}\n`);
      if (platform === "darwin") await installMac(nodeRuntime);
      if (platform === "win32") await ensureServiceUnlocked();
      await waitForExpectedService(runtimeHash);
      const installed = await status();
      if (installed.needsUpdate) throw new Error("The restarted Codex Bridge did not match the bundled runtime.");
      await discardTransactionBackups();
      console.log(`[Codex Bridge] ${version} is installed and the restarted process reported the expected build.`);
      return installed;
    } catch (error) {
      console.error(`[Codex Bridge] ${version} update failed; restoring the previous managed runtime.`);
      let rollbackError = null;
      try {
        await stopService();
        if (previousRuntime) {
          await restorePreviousRuntime(previousRuntime);
          const recoveryVersion = previousMetadata?.version || previousStatus.serviceVersion || "0.0.0";
          const recoveryMetadataText = previousMetadata ? previousMetadataText : `${JSON.stringify({
            version: recoveryVersion,
            runtimeHash: previousRuntimeHash,
            platform,
            codexChannel: previousStatus.codexChannel || codexChannel,
            nodeExecutable: nodeRuntime.executable,
            nodeVersion: nodeRuntime.version,
            nodeSource: nodeRuntime.source,
            installedAt: new Date().toISOString(),
            recovered: true
          }, null, 2)}\n`;
          await restorePreviousMetadata(recoveryMetadataText, Boolean(previousMetadata));
          resetAuthorizationCache();
          const restoredMetadata = await readJson(installMetadata);
          if (restoredMetadata?.nodeExecutable) {
            const previousNodeRuntime = {
              executable: restoredMetadata.nodeExecutable,
              version: restoredMetadata.nodeVersion || "unknown",
              source: restoredMetadata.nodeSource || "unknown"
            };
            if (platform === "darwin") await installMac(previousNodeRuntime, restoredMetadata.version || "0.0.0");
            if (platform === "win32") await ensureServiceUnlocked();
          }
        } else {
          if (platform === "darwin") {
            await rm(bridgeAgent, { force: true });
            await rm(bridgeApp, { recursive: true, force: true });
          }
          await rm(appRoot, { recursive: true, force: true });
          resetAuthorizationCache();
        }
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
      const rollbackDetail = rollbackError ? ` Rollback also failed: ${rollbackError.message}` : " Previous runtime restored.";
      throw new Error(`Codex Bridge installation failed: ${error.message}${rollbackDetail}`);
    } finally {
      await rm(stagedRuntime, { force: true });
    }
  }

  async function install() {
    return serializeLifecycle(installUnlocked);
  }

  async function ensureServiceUnlocked() {
    if (platform !== "win32") return status();
    const probe = await probeBridge();
    if (probe.serviceOnline || Date.now() - lastWindowsServiceStart < 2000) return { ...await status(), ...probe };
    const metadata = await readJson(installMetadata);
    if (!metadata?.nodeExecutable || !await exists(bridgeRuntime) || !await exists(tokenPath)) {
      throw new Error("Codex Bridge is not installed. Use Install / Repair first.");
    }
    const token = (await readFile(tokenPath, "utf8")).trim();
    const child = spawnProcess(metadata.nodeExecutable, [bridgeRuntime], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_BRIDGE_DATA_ROOT: appRoot,
        CODEX_BRIDGE_TOKEN: token
      }
    });
    if (Number.isInteger(child.pid) && child.pid > 0) {
      await writeFile(pidPath, `${child.pid}\n`, { mode: 0o600 });
    } else {
      await rm(pidPath, { force: true });
    }
    child.unref?.();
    lastWindowsServiceStart = Date.now();
    return status();
  }

  async function ensureService() {
    return serializeLifecycle(ensureServiceUnlocked);
  }

  async function ensureCurrent() {
    return serializeLifecycle(async () => {
      const current = await status();
      if (!current.installationDetected) return current;
      const interruptedUpdate = await exists(runtimeBackup) || await exists(metadataBackup);
      if (interruptedUpdate && current.needsUpdate) {
        await rollbackInterruptedUpdate();
        console.log("[Codex Bridge] Interrupted update rolled back; retrying the bundled update in the same lifecycle operation.");
        return installUnlocked();
      }
      if (!current.installed || current.needsUpdate) {
        console.log(`[Codex Bridge] Installed or running build differs from bundled ${version}; starting automatic update.`);
        return installUnlocked();
      }
      if (!current.serviceOnline) {
        try {
          await startInstalledService(await readJson(installMetadata));
          await waitForExpectedService(current.bundledRuntimeHash);
          const ready = await status();
          await discardTransactionBackups();
          return ready;
        } catch (error) {
          if (interruptedUpdate && await rollbackInterruptedUpdate()) {
            console.log("[Codex Bridge] Interrupted restart rolled back; retrying the bundled update once.");
            return installUnlocked();
          }
          throw error;
        }
      }
      await discardTransactionBackups();
      return current;
    });
  }

  async function launch() {
    const current = await ensureCurrent();
    if (!current.installed) throw new Error("Codex Bridge is not installed. Use Install / Repair first.");
    if (platform === "darwin") {
      await execute("/usr/bin/open", [bridgeApp]);
      return status();
    }
    if (platform === "win32") {
      await ensureService();
      try {
        await discoverDebugPort({ platform, execute, fetchImpl });
        await focusCodex({ platform, execute });
      } catch (error) {
        if (!/local debug bridge/.test(error.message)) throw error;
        await launchWindowsCodex({ channel: codexChannel, execute, spawnProcess });
      }
      return status();
    }
    throw new Error(`Codex Bridge launch is not supported on ${platform}.`);
  }

  async function uninstallUnlocked() {
    if (!(platform === "win32" || (platform === "darwin" && Number.isInteger(uid)))) {
      throw new Error("Codex Bridge uninstallation is supported on Windows and macOS only.");
    }
    if (platform === "darwin") {
      await stopService();
      await rm(bridgeAgent, { force: true });
      await rm(bridgeApp, { recursive: true, force: true });
    } else {
      try { await stopService(); } catch {}
    }
    await rm(appRoot, { recursive: true, force: true });
    resetAuthorizationCache();
    return status();
  }

  async function uninstall() {
    return serializeLifecycle(uninstallUnlocked);
  }

  return { status, install, launch, uninstall, ensureService, ensureCurrent, authorizationHeaders };
}
