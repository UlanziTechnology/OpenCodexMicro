// Only user-facing model identifiers/labels cross this boundary. Never evaluate
// configuration as code or silently substitute an unsupported reasoning effort.
export const REASONING_EFFORTS = Object.freeze([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"
]);

const MODEL_LABELS = Object.freeze({
  "gpt-5.6-sol": "5.6 Sol",
  "gpt-5.6-luna": "5.6 Luna",
  "gpt-reserve": "Luna Reserve",
  "gpt-6-astra": "GPT-6 Astra",
  "gemini-3.8-flash-high": "gemini-3.8-flash"
});

export const DEFAULT_MODEL_OPTIONS = Object.freeze([
  Object.freeze({ model: "gpt-6-astra", effort: "low", label: "ASTRA LOW" }),
  Object.freeze({ model: "gpt-6-astra", effort: "medium", label: "ASTRA MED" }),
  Object.freeze({ model: "gemini-3.8-flash-high", effort: "medium", label: "GEMINI MED" }),
  Object.freeze({ model: "gpt-5.6-sol", effort: "high", label: "SOL HIGH" })
]);

const MODEL_DISPLAY_NAMES = Object.freeze({
  "gpt-6-astra": "ASTRA",
  "gemini-3.8-flash-high": "GEMINI",
  "gpt-5.6-sol": "SOL",
  "gpt-5.6-luna": "LUNA",
  "gpt-reserve": "RESERVE"
});

const EFFORT_DISPLAY_NAMES = Object.freeze({
  none: "NONE",
  minimal: "MIN",
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  xhigh: "XHIGH",
  max: "MAX",
  ultra: "ULTRA"
});

export function modelDisplayLabel(selection) {
  if (!selection || typeof selection !== "object") return "CUSTOM MODEL";
  const model = selection.model;
  const effort = selection.effort;

  const defaultMatch = DEFAULT_MODEL_OPTIONS.find(opt =>
    opt.model === model && opt.effort === effort
  );
  if (defaultMatch) return defaultMatch.label;

  const modelKey = value => String(value || "").toLowerCase().replace(/^gpt[- ]/, "").replace(/[- ]/g, "");
  const key = modelKey(model);

  let modelShort = MODEL_DISPLAY_NAMES[model];
  if (!modelShort) {
    if (key === "6astra" || key === "astra") modelShort = "ASTRA";
    else if (key.includes("gemini") || key.includes("flash")) modelShort = "GEMINI";
    else if (key === "5.6sol" || key === "sol") modelShort = "SOL";
    else if (key === "5.6luna" || key === "luna") modelShort = "LUNA";
    else if (key === "reserve" || key === "lunareserve") modelShort = "RESERVE";
  }

  const effortShort = EFFORT_DISPLAY_NAMES[effort] || (typeof effort === "string" && effort.length <= 5 ? effort.toUpperCase() : "");

  if (modelShort && effortShort) {
    return `${modelShort} ${effortShort}`;
  }
  if (modelShort) {
    return modelShort;
  }
  return "CUSTOM MODEL";
}

export function resolveModelSelection(defaults, settings) {
  if (settings === undefined) return defaults;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Invalid model shortcut settings");
  }
  const { model, effort } = settings;
  if (model !== undefined && (typeof model !== "string" || model.length > 100
    || !/^[\p{L}\p{N}\p{M} ._+()/:\-]*$/u.test(model))) {
    throw new Error("Invalid model shortcut model");
  }
  if (effort !== undefined && (typeof effort !== "string"
    || (effort !== "" && !REASONING_EFFORTS.includes(effort)))) {
    throw new Error("Invalid model shortcut reasoning effort");
  }
  const requestedModel = model?.trim() || defaults.model;
  const modelKey = value => value.toLowerCase().replace(/^gpt[- ]/, "").replace(/[- ]/g, "");
  const alias = Object.entries(MODEL_LABELS).find(([id, label]) =>
    modelKey(id) === modelKey(requestedModel) || modelKey(label) === modelKey(requestedModel));
  const selectedModel = alias?.[0] || requestedModel;
  return Object.freeze({
    model: selectedModel,
    displayName: selectedModel === defaults.model ? defaults.displayName : (MODEL_LABELS[selectedModel] || selectedModel),
    effort: effort || (selectedModel === "gemini-3.8-flash-high" ? "medium" : defaults.effort)
  });
}

export function modelSelectionMatches(text, selection) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  const key = label => String(label ?? "").toLowerCase().replace(/^gpt[- ]/, "").replace(/[- ]/g, "");
  const withoutEffort = value.replace(/\s+(?:none|minimal|low|medium|high|xhigh|max|ultra)$/i, "");
  return [selection.model, selection.displayName].filter(Boolean).some(label =>
    key(value) === key(label) || key(withoutEffort) === key(label));
}
