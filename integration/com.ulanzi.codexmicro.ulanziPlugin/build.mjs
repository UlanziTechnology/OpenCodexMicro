import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";

const packageRoot = resolve(".");
const repositoryRoot = resolve(packageRoot, "../..");
const installerRoot = resolve(packageRoot, "installer");

await mkdir("dist", { recursive: true });
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
