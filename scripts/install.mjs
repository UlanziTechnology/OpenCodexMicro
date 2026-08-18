import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = homedir();
const uid = process.getuid();
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const releaseVersion = String(packageMetadata.version);
const start = !process.argv.slice(2).includes("--no-start");
const appRoot = join(home, "Library", "Application Support", "OpenCodexMicro");
const userApplications = join(home, "Applications");
const bridgeApp = join(userApplications, "Codex Bridge.app");
const agentsRoot = join(home, "Library", "LaunchAgents");
const bridgeAgent = join(
  agentsRoot,
  "io.opencodexmicro.bridge.plist"
);
const xml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

await mkdir(appRoot, { recursive: true, mode: 0o700 });
await chmod(appRoot, 0o700);
await mkdir(agentsRoot, { recursive: true });
await mkdir(userApplications, { recursive: true });
execFileSync(process.execPath, [resolve("scripts/build-bridge.mjs")], {
  stdio: "inherit"
});
await cp(resolve("dist/bridge.mjs"), join(appRoot, "bridge.mjs"));

const bridgeContents = join(bridgeApp, "Contents");
const bridgeMacOS = join(bridgeContents, "MacOS");
const bridgeResources = join(bridgeContents, "Resources");
const bridgeLicenses = join(bridgeResources, "licenses");
const bridgeExecutable = join(bridgeMacOS, "Codex Bridge");
const bridgeIcon = join(bridgeResources, "CodexBridge.icns");
const iconset = join(appRoot, "CodexBridge.iconset");
await rm(bridgeApp, { recursive: true, force: true });
await rm(iconset, { recursive: true, force: true });
await mkdir(bridgeMacOS, { recursive: true });
await mkdir(bridgeResources, { recursive: true });
await mkdir(bridgeLicenses, { recursive: true });
await mkdir(iconset, { recursive: true });
for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
  await cp(resolve(notice), join(bridgeLicenses, notice));
  await cp(resolve(notice), join(appRoot, notice));
}

const iconSource = resolve("bridge/CodexBridge.png");
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
  execFileSync("/usr/bin/sips", [
    "-z",
    String(size),
    String(size),
    iconSource,
    "--out",
    join(iconset, name)
  ], { stdio: "ignore" });
}
execFileSync("/usr/bin/iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  bridgeIcon
]);
await rm(iconset, { recursive: true, force: true });

const bridgeInfo = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Codex Bridge</string>
  <key>CFBundleExecutable</key><string>Codex Bridge</string>
  <key>CFBundleIconFile</key><string>CodexBridge</string>
  <key>CFBundleIdentifier</key><string>io.opencodexmicro.bridge</string>
  <key>CFBundleName</key><string>Codex Bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(releaseVersion)}</string>
  <key>CFBundleVersion</key><string>${xml(releaseVersion)}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
await writeFile(join(bridgeContents, "Info.plist"), bridgeInfo);

const bridgeLauncher = `#!/bin/zsh
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

/usr/bin/osascript -e 'display alert "Codex Bridge" message "Codex started, but the bridge endpoint is unavailable. Task keys will use the slower native fallback. Quit Codex and launch Codex Bridge again." as critical'
exit 1
`;
await writeFile(bridgeExecutable, bridgeLauncher, { mode: 0o755 });
await chmod(bridgeExecutable, 0o755);
execFileSync("/usr/bin/codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  bridgeApp
], { stdio: "ignore" });
console.log(`Codex Bridge app installed at: ${bridgeApp}`);

const bridgePlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.opencodexmicro.bridge</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(appRoot, "bridge.mjs"))}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml(join(appRoot, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(appRoot, "bridge-error.log"))}</string>
</dict></plist>
`;
await writeFile(bridgeAgent, bridgePlist, { mode: 0o644 });

for (const agent of [bridgeAgent]) {
  try {
    execFileSync("/bin/launchctl", ["bootout", `gui/${uid}`, agent], {
      stdio: "ignore"
    });
  } catch {
    // The service may not be installed.
  }
}
if (start) {
  execFileSync("/bin/launchctl", ["bootstrap", `gui/${uid}`, bridgeAgent]);
  console.log("Codex Bridge installed and started.");
} else {
  console.log("Codex Bridge installed; daemon start skipped.");
}
