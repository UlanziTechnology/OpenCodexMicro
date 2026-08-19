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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

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
        .map(line => line.trim())
        .find(line => line.startsWith("/") && line.split("/").at(-1) === "node");
      if (discovered) candidates.push(await realpath(discovered));
    } catch {
      // Login-shell discovery is best effort; fixed paths and fallback remain.
    }
  }
  for (const directory of environmentPath.split(delimiter).filter(Boolean)) {
    candidates.push(join(directory, "node"));
  }
  candidates.push(
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    join(home, ".local", "bin", "node")
  );

  let resolvedFallback = fallbackNodeExecutable;
  try {
    resolvedFallback = await realpath(fallbackNodeExecutable);
  } catch {
    // The fallback availability check below will provide the final result.
  }
  for (const executable of [...new Set(candidates)]) {
    if (!executable.startsWith("/")) continue;
    if (!await exists(executable, fsConstants.X_OK)) continue;
    const resolvedExecutable = await realpath(executable);
    if (resolvedExecutable === resolvedFallback) continue;
    const version = await nodeVersion(resolvedExecutable, execute);
    if (version?.major >= 20) {
      return { executable: resolvedExecutable, version: version.text, source: "system" };
    }
  }

  if (await exists(resolvedFallback, fsConstants.X_OK)) {
    const version = await nodeVersion(resolvedFallback, execute);
    if (version?.major >= 20) {
      return { executable: resolvedFallback, version: version.text, source: "ulanzi" };
    }
  }
  throw new Error("No compatible Node.js 20 or later runtime was found.");
}

export function createBridgeInstaller({
  pluginRoot,
  bridgeUrl,
  version,
  home = homedir(),
  uid = process.getuid?.(),
  platform = process.platform,
  nodeExecutable = process.execPath,
  environmentPath = process.env.PATH || "",
  execute = execFileAsync
}) {
  const appRoot = join(home, "Library", "Application Support", "OpenCodexMicro");
  const userApplications = join(home, "Applications");
  const bridgeApp = join(userApplications, "Codex Bridge.app");
  const bridgeContents = join(bridgeApp, "Contents");
  const bridgeMacOS = join(bridgeContents, "MacOS");
  const bridgeResources = join(bridgeContents, "Resources");
  const bridgeLicenses = join(bridgeResources, "licenses");
  const bridgeExecutable = join(bridgeMacOS, "Codex Bridge");
  const bridgeIcon = join(bridgeResources, "CodexBridge.icns");
  const bridgeRuntime = join(appRoot, "bridge.mjs");
  const installMetadata = join(appRoot, "install.json");
  const agentsRoot = join(home, "Library", "LaunchAgents");
  const bridgeAgent = join(agentsRoot, "io.opencodexmicro.bridge.plist");
  const installerRoot = resolve(pluginRoot, "installer");
  const bundledRuntime = join(installerRoot, "bridge.mjs");
  const bundledIcon = join(installerRoot, "CodexBridge.png");

  async function probeBridge() {
    try {
      const response = await fetch(`${bridgeUrl}/health`, {
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
    const [appInstalled, runtimeInstalled, agentInstalled, metadata, probe] = await Promise.all([
      exists(bridgeExecutable, fsConstants.X_OK),
      exists(bridgeRuntime),
      exists(bridgeAgent),
      readJson(installMetadata),
      probeBridge()
    ]);
    const installed = appInstalled && runtimeInstalled && agentInstalled;
    return {
      supported: platform === "darwin" && Number.isInteger(uid),
      installed,
      appInstalled,
      serviceInstalled: runtimeInstalled && agentInstalled,
      installedVersion: metadata?.version || null,
      bundledVersion: version,
      needsUpdate: !installed || metadata?.version !== version,
      appPath: bridgeApp,
      nodeExecutable: metadata?.nodeExecutable || null,
      nodeVersion: metadata?.nodeVersion || null,
      nodeSource: metadata?.nodeSource || null,
      ...probe
    };
  }

  async function buildIcon() {
    const iconset = join(appRoot, "CodexBridge.iconset");
    await rm(iconset, { recursive: true, force: true });
    await mkdir(iconset, { recursive: true });
    try {
      for (const [name, size] of [
        ["icon_16x16.png", 16],
        ["icon_16x16@2x.png", 32],
        ["icon_32x32.png", 32],
        ["icon_32x32@2x.png", 64],
        ["icon_128x128.png", 128],
        ["icon_128x128@2x.png", 256],
        ["icon_256x256.png", 256],
        ["icon_256x256@2x.png", 512],
        ["icon_512x512.png", 512],
        ["icon_512x512@2x.png", 1024]
      ]) {
        await execute("/usr/bin/sips", [
          "-z", String(size), String(size), bundledIcon, "--out", join(iconset, name)
        ]);
      }
      await execute("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", bridgeIcon]);
    } finally {
      await rm(iconset, { recursive: true, force: true });
    }
  }

  async function install() {
    if (platform !== "darwin" || !Number.isInteger(uid)) {
      throw new Error("Codex Bridge installation is supported on macOS only.");
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
    await chmod(appRoot, 0o700);
    await mkdir(userApplications, { recursive: true });
    await mkdir(agentsRoot, { recursive: true });
    await copyFile(bundledRuntime, bridgeRuntime);

    await rm(bridgeApp, { recursive: true, force: true });
    await mkdir(bridgeMacOS, { recursive: true });
    await mkdir(bridgeLicenses, { recursive: true });
    for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
      const source = join(installerRoot, notice);
      await copyFile(source, join(bridgeLicenses, notice));
      await copyFile(source, join(appRoot, notice));
    }
    await buildIcon();

    const info = `<?xml version="1.0" encoding="UTF-8"?>
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
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
    await writeFile(join(bridgeContents, "Info.plist"), info);

    const launcher = `#!/bin/zsh
set -u
unsetopt BG_NICE

codex_binary="/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
bridge_log="$HOME/Library/Logs/OpenCodexMicro-codex-bridge.log"

if [[ ! -x "$codex_binary" ]]; then
  /usr/bin/osascript -e 'display alert "Codex Bridge" message "Codex was not found at /Applications/ChatGPT.app." as critical'
  exit 1
fi

if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then
  /usr/bin/osascript -e 'tell application id "com.openai.codex" to quit'
  for attempt in {1..80}; do
    /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1 || break
    /bin/sleep 0.1
  done
fi

if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display alert "Codex Bridge" message "Codex did not quit, so bridge parameters could not be applied. Quit Codex and try again." as critical'
  exit 1
fi

/usr/bin/nohup "$codex_binary" \\
  --remote-debugging-address=127.0.0.1 \\
  --remote-debugging-port=9222 \\
  --remote-allow-origins=http://127.0.0.1:9222 \\
  >>"$bridge_log" 2>&1 &

for attempt in {1..300}; do
  if /usr/bin/curl --noproxy '*' --silent --fail --max-time 0.2 \\
    http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    exit 0
  fi
  if ! /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 0.1
done

/usr/bin/osascript -e 'display alert "Codex Bridge" message "Codex started, but the bridge endpoint is unavailable. Quit Codex and launch Codex Bridge again." as critical'
exit 1
`;
    await writeFile(bridgeExecutable, launcher, { mode: 0o755 });
    await chmod(bridgeExecutable, 0o755);
    await execute("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bridgeApp]);

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.opencodexmicro.bridge</string>
  <key>ProgramArguments</key><array>
    <string>${xml(nodeRuntime.executable)}</string>
    <string>${xml(bridgeRuntime)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml(join(appRoot, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(appRoot, "bridge-error.log"))}</string>
</dict></plist>
`;
    await writeFile(bridgeAgent, plist, { mode: 0o644 });
    await writeFile(installMetadata, `${JSON.stringify({
      version,
      nodeExecutable: nodeRuntime.executable,
      nodeVersion: nodeRuntime.version,
      nodeSource: nodeRuntime.source,
      installedAt: new Date().toISOString()
    }, null, 2)}\n`, { mode: 0o600 });

    try {
      await execute("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent]);
    } catch {
      // The service may not be loaded yet.
    }
    await execute("/bin/launchctl", ["bootstrap", `gui/${uid}`, bridgeAgent]);
    return status();
  }

  async function launch() {
    if (!await exists(bridgeExecutable, fsConstants.X_OK)) {
      throw new Error("Codex Bridge.app is not installed.");
    }
    await execute("/usr/bin/open", [bridgeApp]);
    return status();
  }

  async function uninstall() {
    if (platform !== "darwin" || !Number.isInteger(uid)) {
      throw new Error("Codex Bridge uninstallation is supported on macOS only.");
    }
    try {
      await execute("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent]);
    } catch {
      // The service may already be stopped or absent.
    }
    await rm(bridgeAgent, { force: true });
    await rm(appRoot, { recursive: true, force: true });
    await rm(bridgeApp, { recursive: true, force: true });
    return status();
  }

  return { status, install, launch, uninstall };
}
