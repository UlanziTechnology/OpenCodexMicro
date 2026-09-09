const SAFE_TRACE_FIELD_KEYS = new Set([
  "accepted",
  "action",
  "alreadyForeground",
  "alreadyMaximized",
  "attentionRequested",
  "attempts",
  "automatic",
  "background",
  "bringToTopAccepted",
  "cacheHit",
  "cacheValid",
  "candidateCount",
  "category",
  "channel",
  "complete",
  "connection",
  "currentEffort",
  "detachAccepted",
  "durationMs",
  "effortMatched",
  "focusOk",
  "foregroundAttach",
  "foregroundAttachErrorCode",
  "forceFocus",
  "inputErrorCode",
  "inputEventsInserted",
  "matchesTarget",
  "modifierStateClear",
  "modelMatched",
  "outcome",
  "path",
  "phase",
  "platform",
  "primaryCandidate",
  "reused",
  "releaseAccepted",
  "route",
  "rowCount",
  "setFocusReturnedWindow",
  "setForegroundAccepted",
  "slot",
  "source",
  "stage",
  "switchRequested",
  "targetAttach",
  "targetAttachErrorCode",
  "targetEffort",
  "targetFound",
  "wasActiveBeforeAttention"
]);

export function safeTraceFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).flatMap(([key, value]) => {
    if (!SAFE_TRACE_FIELD_KEYS.has(key)) return [];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      return [[key, value]];
    }
    const normalized = String(value || "");
    return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? [[key, normalized]] : [];
  }));
}
