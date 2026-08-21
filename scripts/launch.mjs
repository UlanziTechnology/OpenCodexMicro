import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBridgeInstaller } from "../integration/com.ulanzi.codexmicro.ulanziPlugin/plugin/bridge-installer.js";

const pluginRoot = resolve("integration/com.ulanzi.codexmicro.ulanziPlugin");
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const installer = createBridgeInstaller({
  pluginRoot,
  bridgeUrl: process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:17373",
  version: String(packageMetadata.version)
});
await installer.launch();
console.log("Codex Bridge and Codex Desktop launch requested.");
