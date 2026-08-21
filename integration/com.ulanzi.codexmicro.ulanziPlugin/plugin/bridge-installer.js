import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
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
  fetchImpl = fetch
}) {
  const appRoot = bridgeDataRoot({ platform, home, localAppData });
  const bridgeRuntime = join(appRoot, "bridge.mjs");
  const tokenPath = join(appRoot, "bridge-token");
  const installMetadata = join(appRoot, "install.json");
  const installerRoot = resolve(pluginRoot, "installer");
  const bundledRuntime = join(installerRoot, "bridge.mjs");
  const bundledIcon = join(installerRoot, "CodexBridge.png");

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

  async function authorizationHeaders() {
    try {
      const token = (await readFile(tokenPath, "utf8")).trim();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
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
      return { serviceOnline: true, cdpConnected: Boolean(payload.codexConnected), serviceError: null };
    } catch (error) {
      return { serviceOnline: false, cdpConnected: false, serviceError: error.message };
    }
  }

  async function status() {
    const [runtimeInstalled, tokenInstalled, metadata, probe] = await Promise.all([
      exists(bridgeRuntime),
      exists(tokenPath),
      readJson(installMetadata),
      probeBridge()
    ]);
    const macAppInstalled = platform === "darwin"
      ? await exists(bridgeExecutable, fsConstants.X_OK)
      : runtimeInstalled;
    const agentInstalled = platform === "darwin" ? await exists(bridgeAgent) : true;
    const installed = macAppInstalled && runtimeInstalled && tokenInstalled && agentInstalled;
    return {
      supported: platform === "win32" || (platform === "darwin" && Number.isInteger(uid)),
      platform,
      installed,
      appInstalled: macAppInstalled,
      serviceInstalled: runtimeInstalled && tokenInstalled && agentInstalled,
      installedVersion: metadata?.version || null,
      bundledVersion: version,
      needsUpdate: !installed || metadata?.version !== version,
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

  async function installMac(nodeRuntime) {
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
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>CFBundleVersion</key><string>${xml(version)}</string>
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
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml(join(appRoot, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(appRoot, "bridge-error.log"))}</string>
</dict></plist>
`, { mode: 0o644 });
    try { await execute("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent]); } catch {}
    await execute("/bin/launchctl", ["bootstrap", `gui/${uid}`, bridgeAgent]);
  }

  async function install() {
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
    await mkdir(appRoot, { recursive: true, mode: 0o700 });
    if (platform !== "win32") await chmod(appRoot, 0o700);
    await copyFile(bundledRuntime, bridgeRuntime);
    for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
      await copyFile(join(installerRoot, notice), join(appRoot, notice));
    }
    if (!await exists(tokenPath)) {
      await writeFile(tokenPath, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
    }
    await writeFile(installMetadata, `${JSON.stringify({
      version,
      platform,
      codexChannel,
      nodeExecutable: nodeRuntime.executable,
      nodeVersion: nodeRuntime.version,
      nodeSource: nodeRuntime.source,
      installedAt: new Date().toISOString()
    }, null, 2)}\n`, { mode: 0o600 });
    if (platform === "darwin") await installMac(nodeRuntime);
    if (platform === "win32") await ensureService();
    return status();
  }

  async function ensureService() {
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
    child.unref?.();
    lastWindowsServiceStart = Date.now();
    return status();
  }

  async function launch() {
    const current = await status();
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

  async function uninstall() {
    if (!(platform === "win32" || (platform === "darwin" && Number.isInteger(uid)))) {
      throw new Error("Codex Bridge uninstallation is supported on Windows and macOS only.");
    }
    if (platform === "darwin") {
      try { await execute("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent]); } catch {}
      await rm(bridgeAgent, { force: true });
      await rm(bridgeApp, { recursive: true, force: true });
    } else {
      const stopScript = "$target=$env:CODEX_BRIDGE_TARGET_RUNTIME; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -like 'node*' -and $_.CommandLine -like ('*' + $target + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      try {
        await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", stopScript], {
          timeout: 5000,
          env: { ...process.env, CODEX_BRIDGE_TARGET_RUNTIME: bridgeRuntime }
        });
      } catch {}
    }
    await rm(appRoot, { recursive: true, force: true });
    return status();
  }

  return { status, install, launch, uninstall, ensureService, authorizationHeaders };
}
