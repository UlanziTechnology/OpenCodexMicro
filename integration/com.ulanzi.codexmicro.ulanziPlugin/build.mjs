import { mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

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
