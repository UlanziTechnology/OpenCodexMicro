import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const source = resolve(
  "integration/com.ulanzi.codexmicro.ulanziPlugin"
);
const localizationFiles = [
  "en.json",
  "zh_CN.json",
  "zh_HK.json",
  "ja_JP.json",
  "de_DE.json",
  "ko_KR.json",
  "pt_PT.json",
  "es_ES.json"
];
const pluginName = basename(source);
const pluginsRoot = process.platform === "win32"
  ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Ulanzi", "UlanziDeck", "Plugins")
  : join(homedir(), "Library", "Application Support", "Ulanzi", "UlanziDeck", "Plugins");
const destination = join(pluginsRoot, pluginName);
const staging = join(pluginsRoot, `.${pluginName}.installing-${process.pid}`);
const backup = join(pluginsRoot, `.${pluginName}.backup-${process.pid}`);

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const manifest = JSON.parse(
  await readFile(join(source, "manifest.json"), "utf8")
);
if (manifest.UUID !== "com.ulanzi.ulanzistudio.codexmicro") {
  throw new Error(`Unexpected plugin UUID: ${manifest.UUID || "missing"}`);
}
if (!manifest.CodePath || !await exists(join(source, manifest.CodePath))) {
  throw new Error(`Plugin CodePath is missing: ${manifest.CodePath || "unset"}`);
}
for (const action of manifest.Actions || []) {
  if (action.PropertyInspectorPath && !await exists(join(source, action.PropertyInspectorPath))) {
    throw new Error(`Action PropertyInspectorPath is missing: ${action.PropertyInspectorPath}`);
  }
}
for (const banner of manifest.Banner || []) {
  if (!await exists(join(source, banner))) {
    throw new Error(`Manifest Banner is missing: ${banner}`);
  }
}
for (const relative of [
  "installer/bridge.mjs",
  "installer/CodexBridge.png",
  "installer/LICENSE",
  "installer/NOTICE.md",
  "installer/THIRD_PARTY_NOTICES.md"
]) {
  if (!await exists(join(source, relative))) {
    throw new Error(`Bundled Bridge resource is missing: ${relative}`);
  }
}
for (const locale of localizationFiles) {
  const messages = JSON.parse(await readFile(join(source, locale), "utf8"));
  for (const field of ["Name", "Overview", "Description"]) {
    if (typeof messages[field] !== "string" || !messages[field].trim()) {
      throw new Error(`${locale} is missing localized ${field}`);
    }
  }
}

await mkdir(pluginsRoot, { recursive: true });
await rm(staging, { recursive: true, force: true });
await rm(backup, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

for (const relative of [
  "manifest.json",
  ...localizationFiles,
  "assets/icons",
  "assets/banners",
  "dist",
  "installer",
  "property-inspector"
]) {
  const from = join(source, relative);
  const to = join(staging, relative);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

const hadPreviousInstall = await exists(destination);
if (hadPreviousInstall) await rename(destination, backup);
try {
  await rename(staging, destination);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  if (hadPreviousInstall && await exists(backup)) {
    await rename(backup, destination);
  }
  throw error;
}
await rm(backup, { recursive: true, force: true });

console.log(`Ulanzi Studio plugin installed at: ${destination}`);
console.log("Restart Ulanzi Studio to load the updated Codex Micro plugin.");
