import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createBridgeInstaller } from "../integration/com.ulanzi.codexmicro.ulanziPlugin/plugin/bridge-installer.js";

const pluginRoot = resolve("integration/com.ulanzi.codexmicro.ulanziPlugin");
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const installer = createBridgeInstaller({
  pluginRoot,
  bridgeUrl: process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:17373",
  version: String(packageMetadata.version)
});
await installer.uninstall();

const pluginsRoot = process.platform === "win32"
  ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Ulanzi", "UlanziDeck", "Plugins")
  : join(homedir(), "Library", "Application Support", "Ulanzi", "UlanziDeck", "Plugins");
await rm(join(pluginsRoot, "com.ulanzi.codexmicro.ulanziPlugin"), { recursive: true, force: true });
console.log("OpenCodexMicro removed.");
