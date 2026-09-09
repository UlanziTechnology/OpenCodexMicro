import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const secureRoot = dirname(fileURLToPath(import.meta.url));
const dataRoot = process.argv[2];

if (!dataRoot) throw new Error("Codex Bridge elevated launcher requires its data root.");

const metadata = JSON.parse(readFileSync(join(dataRoot, "install.json"), "utf8"));
const runtimeHash = String(metadata.runtimeHash || "");
const nativeRuntimeHash = String(metadata.nativeRuntimeHash || "");

if (!HASH_PATTERN.test(runtimeHash) || !HASH_PATTERN.test(nativeRuntimeHash)) {
  throw new Error("Codex Bridge elevated runtime metadata is invalid.");
}

const runtimePath = join(secureRoot, "runtimes", runtimeHash, "bridge.mjs");
const nativeRoot = join(secureRoot, "native-runtimes", nativeRuntimeHash);
const installedRuntimeHash = createHash("sha256").update(readFileSync(runtimePath)).digest("hex");
if (installedRuntimeHash !== runtimeHash) {
  throw new Error("Codex Bridge protected runtime hash verification failed.");
}

const nativeManifest = JSON.parse(readFileSync(join(nativeRoot, "native-runtime.json"), "utf8"));
if (nativeManifest?.runtimeHash !== nativeRuntimeHash || !Array.isArray(nativeManifest?.files)) {
  throw new Error("Codex Bridge protected native runtime manifest is invalid.");
}
const verifiedNativeFiles = [];
for (const file of nativeManifest.files) {
  const relative = String(file?.path || "").replaceAll("\\", "/");
  if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) {
    throw new Error("Codex Bridge protected native runtime contains an invalid path.");
  }
  const actual = createHash("sha256")
    .update(readFileSync(join(nativeRoot, ...relative.split("/"))))
    .digest("hex");
  if (actual !== file.sha256) {
    throw new Error("Codex Bridge protected native runtime hash verification failed.");
  }
  verifiedNativeFiles.push({ path: relative, sha256: actual });
}
const verifiedNativeHash = createHash("sha256")
  .update(verifiedNativeFiles.map(file => `${file.path}:${file.sha256}`).join("\n"))
  .digest("hex");
if (verifiedNativeHash !== nativeRuntimeHash) {
  throw new Error("Codex Bridge protected native runtime identity verification failed.");
}

process.env.CODEX_BRIDGE_DATA_ROOT = dataRoot;
process.env.CODEX_BRIDGE_NATIVE_ROOT = nativeRoot;
process.env.CODEX_BRIDGE_NATIVE_HASH = nativeRuntimeHash;

const pidPath = join(dataRoot, "bridge.pid");
writeFileSync(pidPath, `${process.pid}\n`, { mode: 0o600 });
process.on("exit", () => {
  try {
    if (Number(readFileSync(pidPath, "utf8").trim()) === process.pid) rmSync(pidPath, { force: true });
  } catch {}
});

await import(pathToFileURL(runtimePath).href);
