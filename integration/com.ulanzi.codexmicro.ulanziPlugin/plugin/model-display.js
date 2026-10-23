import { fillRect, fillRoundedRect, drawText, pngDataUrl } from "./encoder-raster.js";

/** @typedef {{model: string, modelLabel?: string, reasoningEffort?: string, modelIndex?: number, modelCount?: number, reasoningIndex?: number, reasoningCount?: number}} ComposerDisplay */

const xml = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

function modelName(composer) {
  const name = String(composer?.modelLabel || composer?.model || "").trim();
  const gpt = name.match(/^GPT[-\s]*(\d+(?:\.\d+)*)(?:[-\s]+(.*))?$/i);
  if (gpt) return { brand: "GPT", version: gpt[1], family: (gpt[2] || "CODEX").toUpperCase() };
  const words = name.replace(/[-_]+/g, " ").split(/\s+/);
  return { brand: "MODEL", version: words.shift() || "—", family: words.join(" ").toUpperCase() };
}

// Monospace sizing is conservative on Qt's SVG renderer, which lacks textLength support.
function fit(value, width, maxSize) {
  const text = [...String(value)];
  const advance = char => /[^\x00-\xff]/u.test(char) ? 1 : 0.64;
  const units = text.reduce((sum, char) => sum + advance(char), 0);
  const size = Math.min(maxSize, width / Math.max(1, units));
  if (size >= 8) return { text: text.join(""), size: size.toFixed(1) };
  let used = 1, shortened = "";
  for (const char of text) {
    used += advance(char);
    if (used * 8 > width) break;
    shortened += char;
  }
  return { text: `${shortened}…`, size: "8.0" };
}

/**
 * Draw the complete 126×140 dial surface as one SVG so native title settings
 * cannot push labels outside their allotted space. Indices run left-low/right-high.
 * @param {ComposerDisplay|null} composer
 * @param {'model'|'reasoning'} [mode]
 * @param {boolean} [connected]
 * @returns {string}
 */
export function modelEncoderSvg(composer, mode = "model", connected = true) {
  const ready = connected && Boolean(composer?.model);
  const held = mode === "reasoning";
  const mint = "#303638", amber = "#303638", muted = "#858c8f";
  const accent = ready ? held ? amber : mint : muted;
  const name = ready ? modelName(composer) : { brand: "CODEX", version: "—", family: connected ? "NO MODEL" : "OFFLINE" };
  const primary = held && ready ? String(composer.reasoningEffort || "—").toUpperCase() : name.version;
  const version = fit(primary, 70, held ? 29 : 34);
  const family = fit(held && ready ? `${name.version} ${name.family}` : name.family, 102, 11);
  const count = held ? composer?.reasoningCount : composer?.modelCount;
  const index = held ? composer?.reasoningIndex : composer?.modelIndex;
  const counter = ready && index >= 0 && count > 0 ? `${index + 1}/${count}` : "—";
  const modelCount = Math.max(0, Math.min(32, Number(composer?.modelCount) || 0));
  const modelIndex = Number.isInteger(composer?.modelIndex) ? composer.modelIndex : -1;
  const gap = modelCount > 16 ? 1 : 3;
  const width = modelCount ? (90 - gap * (modelCount - 1)) / modelCount : 90;
  const rail = Array.from({ length: modelCount || 1 }, (_, i) =>
    `<rect x="${(18 + i * (width + gap)).toFixed(2)}" y="77" width="${width.toFixed(2)}" height="4" rx="1.5" fill="${ready && i === modelIndex ? mint : "#c1c8c5"}" opacity="${held ? 0.5 : 1}"/>`
  ).join("");
  const effortCount = Math.max(0, Math.min(12, Number(composer?.reasoningCount) || 0));
  const effortIndex = Number.isInteger(composer?.reasoningIndex) ? composer.reasoningIndex : -1;
  const barWidth = effortCount ? (96 - 4 * (effortCount - 1)) / effortCount : 96;
  const bars = Array.from({ length: effortCount || 1 }, (_, i) => {
    const height = effortCount > 1 ? 3 + i * 10 / (effortCount - 1) : 5;
    return `<rect x="${(15 + i * (barWidth + 4)).toFixed(2)}" y="${(122 - height).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="1.4" fill="${ready && i <= effortIndex ? amber : "#bac4bf"}"/>`;
  }).join("");
  const effort = fit(ready ? String(composer.reasoningEffort || "—").toUpperCase() : "—", 51, 9);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="126" height="140" viewBox="0 0 126 140">
  <defs><linearGradient id="bg" x2="0.8" y2="1"><stop stop-color="#eeeeed"/><stop offset="1" stop-color="#d5d7d6"/></linearGradient></defs>
  <rect width="126" height="140" fill="#dedfdf"/>
  <rect x="1" y="1" width="124" height="138" rx="10" fill="url(#bg)" stroke="#bfc4c2"/>
  <g font-family="Menlo,Consolas,monospace">
    <text x="12" y="18" fill="${accent}" font-size="7" font-weight="700" letter-spacing="1.2">${held ? "EFFORT" : "MODEL"}</text>
    <text x="114" y="18" fill="${accent}" font-size="7" text-anchor="end">${counter}</text>
    <text x="11" y="55" fill="${ready ? held ? amber : "#303638" : muted}" font-size="${version.size}" font-weight="700" letter-spacing="${Number(version.size) > 24 ? -1.8 : 0}">${xml(version.text)}</text>
    <text x="113" y="38" fill="#a4b6ab" font-size="7" text-anchor="end" letter-spacing="1">${xml(name.brand)}</text>
    <path d="M99 47h14m-4-4 4 4-4 4" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="12" y="69" fill="${ready ? "#303638" : muted}" font-size="${family.size}" font-weight="700" letter-spacing="0.3">${xml(family.text)}</text>
    <text x="10" y="82" fill="#7b8b81" font-size="8" text-anchor="middle">−</text>
    ${rail}
    <text x="116" y="82" fill="${ready ? mint : muted}" font-size="8" text-anchor="middle">+</text>
    <rect x="8" y="90" width="110" height="39" rx="6" fill="${held ? "#d2d8d5" : "#e4e7e5"}" stroke="${held ? "#73847d" : "#b4bfba"}"/>
    <text x="15" y="103" fill="${held ? amber : "#829284"}" font-size="6" letter-spacing="0.8">EFFORT</text>
    <text x="111" y="103" fill="${ready ? amber : muted}" font-size="${effort.size}" font-weight="700" text-anchor="end">${xml(effort.text)}</text>
    ${bars}
  </g>
</svg>`;
}


/**
 * Rasterise the encoder surface to a PNG data URL. The plugin sends this
 * through the host's normal state-image path; Ulanzi Studio then writes the
 * decoded PNG into the outgoing device ZIP instead of asking firmware to
 * decode an inline custom-layout data URL.
 * @param {ComposerDisplay|null} composer
 * @param {'model'|'reasoning'} [mode]
 * @param {boolean} [connected]
 * @returns {string}
 */
export function modelEncoderPng(composer, mode = "model", connected = true) {
  const width = 126;
  const height = 140;
  const pixels = new Uint8Array(width * height * 4);
  const ready = connected && Boolean(composer?.model);
  const held = mode === "reasoning";
  const name = ready ? modelName(composer) : { brand: "CODEX", version: "-", family: connected ? "NO MODEL" : "OFFLINE" };
  const primary = name.version;
  const family = name.family;
  const primaryColor = ready ? "#0d8a70" : "#858c8f";
  const effortColor = ready ? held ? "#94621b" : "#087f5b" : "#858c8f";
  const modelCount = Math.max(0, Math.min(32, Number(composer?.modelCount) || 0));
  const modelIndex = Number.isInteger(composer?.modelIndex) ? composer.modelIndex : -1;

  const effortCount = Math.max(0, Math.min(12, Number(composer?.reasoningCount) || 0));
  const effortIndex = Number.isInteger(composer?.reasoningIndex) ? composer.reasoningIndex : -1;

  // Leave corner pixels transparent so the silver card retains its silhouette.
  fillRoundedRect(pixels, width, height, 0, 0, 126, 140, 12, "#bfc4c2");
  fillRoundedRect(pixels, width, height, 1, 1, 124, 138, 11, "#eeeeed");
  const primaryScale = Math.min(5, 108 / Math.max(6, primary.length * 6));
  drawText(pixels, width, height, primary, 63, 10, primaryScale, primaryColor, 110, "middle");
  const familyScale = Math.min(2.5, 108 / Math.max(6, family.length * 6));
  drawText(pixels, width, height, family, 63, 53, familyScale, ready ? "#315d69" : "#858c8f", 110, "middle");
  drawText(pixels, width, height, "-", 10, 76, 1, "#7b8b81", 8, "middle");
  drawText(pixels, width, height, "+", 116, 76, 1, primaryColor, 8, "middle");
  const gap = modelCount > 16 ? 1 : 3;
  const railWidth = modelCount ? (90 - gap * (modelCount - 1)) / modelCount : 90;
  for (let index = 0; index < Math.max(1, modelCount); index += 1) {
    fillRect(pixels, width, height, 18 + index * (railWidth + gap), 77, railWidth, 4, ready && index === modelIndex ? "#10a37f" : "#c1c8c5");
  }
  fillRoundedRect(pixels, width, height, 8, 90, 110, 39, 6, held ? "#b99a60" : "#b4bfba");
  fillRoundedRect(pixels, width, height, 9, 91, 108, 37, 5, held ? "#eee4cd" : "#e0eae4");
  const effort = ready ? String(composer.reasoningEffort || "-") : "-";
  const effortScale = Math.min(2.5, 100 / Math.max(6, effort.length * 6));
  drawText(pixels, width, height, effort, 63, 94, effortScale, effortColor, 104, "middle");
  const barWidth = effortCount ? (96 - 4 * (effortCount - 1)) / effortCount : 96;
  for (let index = 0; index < Math.max(1, effortCount); index += 1) {
    const barHeight = effortCount > 1 ? 3 + index * 6 / (effortCount - 1) : 5;
    fillRect(pixels, width, height, 15 + index * (barWidth + 4), 125 - barHeight, barWidth, barHeight, ready && index <= effortIndex ? effortColor : "#bac4bf");
  }
  return pngDataUrl(pixels, width, height);
}
