import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const output = resolve(root, "dist", "bridge.mjs");
const packageMetadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
await mkdir(resolve(root, "dist"), { recursive: true });
await build({
  entryPoints: [resolve(root, "src", "bridge", "server.mjs")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
  define: {
    __CODEX_BRIDGE_VERSION__: JSON.stringify(String(packageMetadata.version))
  },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});
console.log(`Built bridge: ${output}`);
