import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";

const packageRoot = resolve(".");
const repositoryRoot = resolve(packageRoot, "../..");
const installerRoot = resolve(packageRoot, "installer");
const nativeRuntimeRoot = resolve(installerRoot, "native-runtime");
const manifest = JSON.parse(await readFile(resolve(packageRoot, "manifest.json"), "utf8"));

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
  external: ["koffi"],
  define: {
    __CODEX_BRIDGE_VERSION__: JSON.stringify(String(manifest.Version))
  },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});

const nativeRuntimeFiles = [
  ["koffi/index.cjs", "node_modules/koffi/index.cjs"],
  ["koffi/src/koffi/index.cjs", "node_modules/koffi/src/koffi/index.cjs"],
  ["koffi/src/koffi/src/static.cjs", "node_modules/koffi/src/koffi/src/static.cjs"],
  ["koffi/package.json", "node_modules/koffi/package.json"],
  ["koffi/LICENSE.txt", "node_modules/koffi/LICENSE.txt"],
  ["@koromix/koffi-win32-x64/index.js", "node_modules/@koromix/koffi-win32-x64/index.js"],
  ["@koromix/koffi-win32-x64/package.json", "node_modules/@koromix/koffi-win32-x64/package.json"],
  ["@koromix/koffi-win32-x64/README.md", "node_modules/@koromix/koffi-win32-x64/README.md"],
  ["@koromix/koffi-win32-x64/win32_x64/koffi.node", "node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node"]
];
await rm(nativeRuntimeRoot, { recursive: true, force: true });
const manifestFiles = [];
for (const [sourceRelative, destinationRelative] of nativeRuntimeFiles) {
  const source = resolve(repositoryRoot, "node_modules", sourceRelative);
  const destination = resolve(nativeRuntimeRoot, destinationRelative);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await copyFile(source, destination);
  const sha256 = createHash("sha256").update(await readFile(destination)).digest("hex");
  manifestFiles.push({ path: destinationRelative.replaceAll("\\", "/"), sha256 });
}
const nativeRuntimeHash = createHash("sha256")
  .update(manifestFiles.map(file => `${file.path}:${file.sha256}`).join("\n"))
  .digest("hex");
await writeFile(resolve(nativeRuntimeRoot, "native-runtime.json"), `${JSON.stringify({
  version: 1,
  runtimeHash: nativeRuntimeHash,
  platform: "win32",
  architecture: "x64",
  files: manifestFiles
}, null, 2)}\n`);
await copyFile(resolve(repositoryRoot, "bridge/CodexBridge.png"), resolve(installerRoot, "CodexBridge.png"));
for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
  await copyFile(resolve(repositoryRoot, notice), resolve(installerRoot, notice));
}
