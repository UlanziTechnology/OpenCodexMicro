import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";
import { modelEncoderPng, modelEncoderSvg } from "./plugin/model-display.js";
import { permissionEncoderPng, permissionActionPng } from "./plugin/permission-display.js";

const packageRoot = resolve(".");
const repositoryRoot = resolve(packageRoot, "../..");
const installerRoot = resolve(packageRoot, "installer");

await mkdir("dist", { recursive: true });
await mkdir("assets/encoder", { recursive: true });
await mkdir("layouts", { recursive: true });
await writeFile("assets/encoder/model-standby.svg", modelEncoderSvg(null));
await writeFile("assets/encoder/model-standby.png", Buffer.from(modelEncoderPng(null).split(",", 2)[1], "base64"));
await writeFile("assets/encoder/permissions-standby.png", Buffer.from(permissionEncoderPng(null).split(",", 2)[1], "base64"));
await writeFile("assets/icons/permissions.png", Buffer.from(permissionActionPng().split(",", 2)[1], "base64"));
await writeFile("layouts/model-encoder.json", `${JSON.stringify({
  id: "codex-model-encoder",
  items: [{
    type: "pixmap",
    // The host copies state(type:1) images into the device ZIP only for the
    // standard icon key. Keeping this key is what makes the physical dial
    // receive a real Images/*.png file instead of a data URL.
    key: "icon",
    background: "transparent",
    enabled: true,
    rect: [0, 7, 126, 126],
    zOrder: 0,
    value: "assets/encoder/model-standby.png"
  }, {
    type: "text",
    // Physical D200X testing requires this empty text item, even when hidden.
    key: "model-label",
    background: "transparent",
    enabled: false,
    rect: [0, 105, 126, 35],
    zOrder: 1,
    alignment: "center",
    color: "#dfdfdf",
    font: { size: 7 },
    text: ""
  }]
}, null, 2)}\n`);
for (const [action, image] of [
  ["navigate", "assets/icons/task-idle.png"],
  ["context", "assets/icons/context.png"],
  ["permissions", "assets/encoder/permissions-standby.png"]
]) {
  await writeFile(`layouts/${action}-encoder.json`, `${JSON.stringify({
    id: `codex-${action}-encoder`,
    items: [{
      type: "pixmap", key: "icon", background: "transparent", enabled: true,
      rect: [0, 7, 126, 126], zOrder: 0, value: image
    }, {
      // Keep the hardware-required text item empty; never use the host title key.
      type: "text", key: "encoder-label", background: "transparent", enabled: false,
      rect: [0, 105, 126, 35], zOrder: 1, alignment: "center", color: "#dfdfdf",
      font: { size: 7 }, text: ""
    }]
  }, null, 2)}\n`);
}
await build({
  bundle: true,
  entryPoints: ["plugin/app.js"],
  format: "cjs",
  outfile: "dist/app.js",
  platform: "node",
  target: "node20"
});
await writeFile("dist/package.json", '{\n  "type": "commonjs"\n}\n');
await rm("dist/licenses", { recursive: true, force: true });

await mkdir(installerRoot, { recursive: true });
await build({
  bundle: true,
  entryPoints: [resolve(repositoryRoot, "src/bridge/server.mjs")],
  format: "esm",
  outfile: resolve(installerRoot, "bridge.mjs"),
  platform: "node",
  target: "node20",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});
await copyFile(resolve(repositoryRoot, "bridge/CodexBridge.png"), resolve(installerRoot, "CodexBridge.png"));
for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
  await copyFile(resolve(repositoryRoot, notice), resolve(installerRoot, notice));
}
