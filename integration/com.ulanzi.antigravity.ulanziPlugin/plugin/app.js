import { taskProgressMarkup } from "../../../src/shared/task-progress.mjs";
import { textCard } from "../../../src/shared/deck-cards.mjs";
import { unavailableIcon, encoderTicks, invalidateDisplays, reportActionError, bridgeFeed, inspectorReply } from "../../../src/shared/plugin-runtime.mjs";
import { localClient } from "../../../src/shared/local-api.mjs";
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.antigravity";
const BRIDGE_URL = process.env.ANTIGRAVITY_BRIDGE_URL || "http://127.0.0.1:17374";
const requestLocal = localClient("antigravity", BRIDGE_URL);
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();
const PLUGIN_ROOT = resolve(dirname(resolve(process.argv[1])), "..");
const USAGE_BASE64 = readFileSync(
  resolve(PLUGIN_ROOT, "assets/icons/usage-base.png")
).toString("base64");

const ACTION_LABELS = Object.freeze({
  task1: "SESSION 1",
  task2: "SESSION 2",
  task3: "SESSION 3",
  task4: "SESSION 4",
  task5: "SESSION 5",
  task6: "SESSION 6",
  proceed: "PROCEED",
  cancel: "CANCEL",
  attention: "ATTENTION",
  subagents: "SUBAGENTS",
  plan: "PLAN",
  walkthrough: "WALKTHROUGH",
  usage: "USAGE",
  usage5h: "5H USAGE",
  usageweekly: "WK USAGE",
  new: "NEW",
  navigate: "LATEST",
  hud: "HUD",
  boost: "BOOST",
  grillme: "GRILL-ME",
  goal: "GOAL",
  approve: "APPROVE", reject: "REJECT", stop: "STOP", pin: "PIN", submit: "SUBMIT", mic: "MIC", model: "MODEL", fork: "FORK", reasoning: "REASONING", steer: "SEND NOW",
  prompt_test: "TEST", prompt_review: "REVIEW", prompt_commit: "COMMIT MSG",
  tokens: "TOKENS"
});

const TASK_ICON_PATHS = Object.freeze({
  idle: "assets/icons/task-idle.png",
  working: "assets/icons/task-working.png",
  complete: "assets/icons/task-complete.png",
  attention: "assets/icons/task-attention.png",
  error: "assets/icons/task-error.png"
});

function taskIconPath(status) {
  const value = String(status || "").toLowerCase();
  if (["working", "thinking", "running", "in_progress", "executing", "planning"].includes(value)) return TASK_ICON_PATHS.working;
  if (["unread", "complete", "completed", "done", "success"].includes(value)) return TASK_ICON_PATHS.complete;
  if (["attention", "notification", "input", "approval", "waiting_input", "needs_input", "waiting"].includes(value)) return TASK_ICON_PATHS.attention;
  if (["error", "failed", "failure"].includes(value)) return TASK_ICON_PATHS.error;
  return TASK_ICON_PATHS.idle;
}

function shortTitle(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

let socket;
let reconnectTimer;
let pollTimer;
let pollInFlight = false;
let latestState = null;
const sessionStartTimes = new Map();

function updateSessionRunningTimes(slots, activeTasks) {
  const currentRunningKeys = new Set();
  const allItems = [...(slots || []), ...(activeTasks || [])];
  for (const item of allItems) {
    if (!item?.threadKey) continue;
    const isRunning = ["working", "running", "thinking", "in_progress"].includes(String(item.status || "").toLowerCase());
    if (isRunning) {
      currentRunningKeys.add(item.threadKey);
      if (!sessionStartTimes.has(item.threadKey)) {
        sessionStartTimes.set(item.threadKey, item.startedAt || Date.now());
      }
    }
  }
  for (const key of sessionStartTimes.keys()) {
    if (!currentRunningKeys.has(key)) {
      sessionStartTimes.delete(key);
    }
  }
}

function formatElapsed(ms) {
  if (!ms || ms < 0) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function extractWindowUsage(usage, kind) {
  const windows = Array.isArray(usage?.windows) ? usage.windows : [];
  const window = windows.find((item) => item?.kind === kind);
  if (!window || window.remainingPercent == null) return null;
  const remaining = Number(window.remainingPercent);
  return Number.isFinite(remaining)
    ? Math.max(0, Math.min(100, Math.round(remaining)))
    : null;
}

function usageRemaining(usage) {
  return {
    fiveHour: extractWindowUsage(usage, "five-hour") ?? extractWindowUsage(usage, "session") ?? extractWindowUsage(usage, "context"),
    weekly: extractWindowUsage(usage, "weekly")
  };
}

function formatResetCountdown(resetsAt, defaultLabel = null) {
  if (!resetsAt) return defaultLabel;
  let targetMs;
  if (typeof resetsAt === "number" && Number.isFinite(resetsAt)) {
    targetMs = resetsAt > 1e11 ? resetsAt : resetsAt * 1000;
  } else if (typeof resetsAt === "string") {
    const parsed = Date.parse(resetsAt);
    if (Number.isFinite(parsed)) {
      targetMs = parsed;
    } else {
      const num = Number(resetsAt);
      if (Number.isFinite(num)) targetMs = num > 1e11 ? num : num * 1000;
      else return defaultLabel;
    }
  } else {
    return defaultLabel;
  }
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) return defaultLabel;
  if (diffMs < 3600000) {
    const mins = Math.max(1, Math.ceil(diffMs / 60000));
    return `RESET ${mins}M`;
  }
  if (diffMs < 86400000) {
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return mins > 0 ? `RESET ${hrs}H ${mins}M` : `RESET ${hrs}H`;
  }
  const days = Math.floor(diffMs / 86400000);
  const hrs = Math.floor((diffMs % 86400000) / 3600000);
  return hrs > 0 ? `RESET ${days}D ${hrs}H` : `RESET ${days}D`;
}

function getPrimaryResetText(usage) {
  const windows = Array.isArray(usage?.windows) ? usage.windows : [];
  const primary = windows.find((w) => w?.kind === "five-hour" && w?.resetsAt) ||
                  windows.find((w) => w?.kind === "session" && w?.resetsAt) ||
                  windows.find((w) => w?.resetsAt);
  return primary?.resetsAt ? formatResetCountdown(primary.resetsAt) : null;
}

function getUsageProgressColor(remaining) {
  if (remaining === null) return "#858c8f";
  if (remaining >= 50) return "#2fbd7f";
  if (remaining >= 20) return "#e89b2d";
  return "#e45861";
}

function usageIconData(usage) {
  const { fiveHour, weekly } = usageRemaining(usage);
  const col1 = getUsageProgressColor(fiveHour);
  const col2 = getUsageProgressColor(weekly);
  const resetLabel = getPrimaryResetText(usage);

  const r1 = 60;
  const r2 = 47;
  const c1 = 2 * Math.PI * r1;
  const c2 = 2 * Math.PI * r2;
  const filled1 = c1 * (fiveHour ?? 0) / 100;
  const filled2 = c2 * (weekly ?? 0) / 100;

  const val1 = fiveHour === null ? "—" : String(fiveHour);
  const pct1 = fiveHour === null ? "" : "%";
  const val2 = weekly === null ? "—" : String(weekly);
  const pct2 = weekly === null ? "" : "%";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <image width="196" height="196" href="data:image/png;base64,${USAGE_BASE64}" xlink:href="data:image/png;base64,${USAGE_BASE64}"/>
    <g fill="none" transform="rotate(-90 98 94)">
      <!-- Outer Track (5H) -->
      <circle cx="98" cy="94" r="${r1}" stroke="#5e6c68" stroke-opacity=".25" stroke-width="7"/>
      <circle cx="98" cy="94" r="${r1}" stroke="#a0aca9" stroke-opacity=".3" stroke-width="5"/>
      <!-- Inner Track (Weekly) -->
      <circle cx="98" cy="94" r="${r2}" stroke="#5e6c68" stroke-opacity=".25" stroke-width="7"/>
      <circle cx="98" cy="94" r="${r2}" stroke="#a0aca9" stroke-opacity=".3" stroke-width="5"/>
      <!-- Outer Progress (5H) -->
      ${fiveHour !== null ? `
        <circle cx="98" cy="94" r="${r1}" stroke="${col1}" stroke-opacity=".4" stroke-width="10" stroke-linecap="butt" stroke-dasharray="${filled1} ${c1 - filled1}" filter="url(#glow)"/>
        <circle cx="98" cy="94" r="${r1}" stroke="${col1}" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${filled1} ${c1 - filled1}"/>
      ` : ""}
      <!-- Inner Progress (Weekly) -->
      ${weekly !== null ? `
        <circle cx="98" cy="94" r="${r2}" stroke="${col2}" stroke-opacity=".4" stroke-width="10" stroke-linecap="butt" stroke-dasharray="${filled2} ${c2 - filled2}" filter="url(#glow)"/>
        <circle cx="98" cy="94" r="${r2}" stroke="${col2}" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${filled2} ${c2 - filled2}"/>
      ` : ""}
    </g>
    <!-- Center text: 5H and WK -->
    <text x="98" y="85" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif">
      <tspan font-size="11" font-weight="700" fill="#6b787c" letter-spacing="0.5">5H </tspan>
      <tspan font-size="17" font-weight="800" fill="#2d3335">${val1}${pct1 ? `<tspan dx="1" dy="-2" font-size="11" font-weight="700" fill="#6b787c">${pct1}</tspan>` : ""}</tspan>
    </text>
    <text x="98" y="108" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif">
      <tspan font-size="11" font-weight="700" fill="#6b787c" letter-spacing="0.5">WK </tspan>
      <tspan font-size="17" font-weight="800" fill="#2d3335">${val2}${pct2 ? `<tspan dx="1" dy="-2" font-size="11" font-weight="700" fill="#6b787c">${pct2}</tspan>` : ""}</tspan>
    </text>
    ${resetLabel ? `
      <text x="98" y="166" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="9" font-weight="800" fill="#6b787c" letter-spacing="0.8">${resetLabel}</text>
    ` : ""}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function singleUsageIconData({
  header = "AGY 5H",
  remaining = null,
  resetsAt = null,
  connected = true
}) {
  const isWeekly = header.includes("WK") || header.includes("WEEK");
  const defaultReset = "RESET UNKNOWN";
  const resetLabel = formatResetCountdown(resetsAt, defaultReset);

  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <rect x="1" y="1" width="194" height="194" rx="23" fill="none" stroke="#262c36" stroke-width="2"/>
      <g transform="translate(98, 28)">
        <rect x="-58" y="-14" width="116" height="28" rx="14" fill="#21262d" stroke="#30363d" stroke-width="1"/>
        <text x="0" y="5.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#94a3b8" letter-spacing="0.8">${escapeXml(header)}</text>
      </g>
      <circle cx="98" cy="96" r="38" fill="none" stroke="#21262d" stroke-width="8"/>
      <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="28" font-weight="900" fill="#64748b">—</text>
      <text x="98" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#ef4444" letter-spacing="0.6">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const r = 38;
  const c = 2 * Math.PI * r;
  const val = remaining === null ? 0 : Math.max(0, Math.min(100, Math.round(remaining)));
  const filled = (c * val) / 100;
  const col = getUsageProgressColor(remaining);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <filter id="glowSingleAgy" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="#13161a"/>
    <rect x="1" y="1" width="194" height="194" rx="23" fill="none" stroke="#262c36" stroke-width="2"/>
    
    <!-- Top Badge -->
    <g transform="translate(98, 28)">
      <rect x="-58" y="-14" width="116" height="28" rx="14" fill="#1e242c" stroke="#303844" stroke-width="1.2"/>
      <text x="0" y="5.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#f1f5f9" letter-spacing="0.8">${escapeXml(header)}</text>
    </g>

    <!-- Gauge Ring -->
    <circle cx="98" cy="96" r="${r}" fill="none" stroke="#21262d" stroke-width="8"/>
    ${remaining !== null ? `
      <circle cx="98" cy="96" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${filled} ${c - filled}" transform="rotate(-90 98 96)"/>
    ` : ""}

    <!-- Center Big Value -->
    <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif">
      <tspan font-size="28" font-weight="900" fill="#ffffff" letter-spacing="-0.5">${remaining === null ? "—" : val}</tspan>
      ${remaining !== null ? `<tspan font-size="14" font-weight="700" fill="#94a3b8" dx="1">%</tspan>` : ""}
    </text>

    <!-- Bottom Countdown / Status -->
    <text x="98" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#cbd5e1" letter-spacing="0.5">${escapeXml(resetLabel)}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function contextOf(message) {
  return String(message.actionid || `${message.uuid}___${message.key}`);
}

function taskSlot(uuid) {
  const match = String(uuid || "").match(/\.task([1-6])$/);
  return match ? Number(match[1]) - 1 : null;
}

function actionName(uuid) {
  const name = String(uuid || "").split(".").at(-1);
  return Object.hasOwn(ACTION_LABELS, name) ? name : null;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sessionCardIconData({
  headerLeft = "AGY",
  headerRight = "Session 1",
  title = "No Session",
  status = "idle",
  elapsed = "",
  model = null,
  ctxPct = null,
  progress = null,
  connected = true,
  empty = false
}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <clipPath id="cardClipOffAgy">
          <rect width="196" height="196" rx="24"/>
        </clipPath>
      </defs>
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <g clip-path="url(#cardClipOffAgy)">
        <rect x="0" y="0" width="196" height="38" fill="#272e39"/>
      </g>
      <rect x="1" y="1" width="194" height="194" rx="23" fill="none" stroke="#262c36" stroke-width="2"/>
      <text x="12" y="24" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="0.8">${escapeXml(headerLeft)}</text>
      <text x="184" y="24" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="700" fill="rgba(255,255,255,0.7)" letter-spacing="0.3">${escapeXml(headerRight)}</text>
      <text x="98" y="98" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="17" font-weight="800" fill="#8a96a3" letter-spacing="0.5">Bridge Offline</text>
      <text x="98" y="122" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="700" fill="#ef4444" letter-spacing="0.4">disconnected</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (empty) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <clipPath id="cardClipEmptyAgy">
          <rect width="196" height="196" rx="24"/>
        </clipPath>
      </defs>
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <g clip-path="url(#cardClipEmptyAgy)">
        <rect x="0" y="0" width="196" height="38" fill="#21262d"/>
      </g>
      <rect x="1" y="1" width="194" height="194" rx="23" fill="none" stroke="#262c36" stroke-width="2"/>
      <text x="12" y="24" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#8a96a3" letter-spacing="0.8">${escapeXml(headerLeft)}</text>
      <text x="184" y="24" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="700" fill="#64748b" letter-spacing="0.3">${escapeXml(headerRight)}</text>
      <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="17" font-weight="800" fill="#64748b" letter-spacing="0.5">No Session</text>
      <text x="98" y="128" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="600" fill="#475569" letter-spacing="0.4">idle</text>
      <text x="12" y="162" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#475569">—</text>
      <text x="184" y="162" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#475569">ctx —</text>
      <rect x="12" y="172" width="172" height="7" rx="3.5" fill="#1e242c"/>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const s = String(status || "").toLowerCase();
  const isWorking = s === "working" || s === "running" || s === "thinking" || s === "in_progress" || s === "executing" || s === "planning";
  const isAttention = s === "attention" || s === "waiting" || s === "feedback";
  const isError = s === "error" || s === "failed";
  const isDone = s === "complete" || s === "completed" || s === "done";

  let headerBg = "#334155";
  let subColor = "#94a3b8";
  let subText = s === "unknown" ? "unknown" : "idle";

  if (isWorking) {
    headerBg = "#22c55e";
    subColor = "#22c55e";
    subText = elapsed ? `${s === "thinking" ? "thinking" : "working"} ${elapsed}` : (s === "thinking" ? "thinking" : "working");
  } else if (isAttention) {
    headerBg = "#f59e0b";
    subColor = "#f59e0b";
    subText = elapsed ? `waiting ${elapsed}` : "waiting";
  } else if (isError) {
    headerBg = "#ef4444";
    subColor = "#ef4444";
    subText = "error";
  } else if (isDone) {
    headerBg = "#3b82f6";
    subColor = "#60a5fa";
    subText = elapsed ? `done ${elapsed}` : "done";
  }

  const cleanTitle = String(title || "Untitled").trim();
  const titleDisplay = cleanTitle.length > 14 ? cleanTitle.slice(0, 13) + "…" : cleanTitle;
  const titleFontSize = titleDisplay.length > 11 ? "18" : "20";

  const cleanModel = String(model || "unknown").trim().toLowerCase();
  const modelDisplay = cleanModel.length > 11 ? cleanModel.slice(0, 10) + "…" : cleanModel;

  const validPct = ctxPct == null || !Number.isFinite(Number(ctxPct)) ? null : Math.max(0, Math.min(100, Math.round(Number(ctxPct))));
  const barWidth = Math.max(0, Math.min(172, Math.round((validPct / 100) * 172)));
  const barColor = validPct > 85 ? "#ef4444" : "#f59e0b";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <clipPath id="cardClipAgy">
        <rect width="196" height="196" rx="24"/>
      </clipPath>
    </defs>
    <rect width="196" height="196" rx="24" fill="#13161a"/>
    <g clip-path="url(#cardClipAgy)">
      <rect x="0" y="0" width="196" height="38" fill="${headerBg}"/>
    </g>
    <rect x="1" y="1" width="194" height="194" rx="23" fill="none" stroke="${isWorking ? '#16a34a' : isAttention ? '#d97706' : '#262c36'}" stroke-width="2"/>
    <text x="12" y="24" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="0.8">${escapeXml(headerLeft)}</text>
    <text x="184" y="24" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="700" fill="rgba(255,255,255,0.95)" letter-spacing="0.3">${escapeXml(headerRight)}</text>
    
    <text x="98" y="70" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="${titleFontSize}" font-weight="800" fill="#ffffff" letter-spacing="0.4">${escapeXml(titleDisplay)}</text>
    <text x="98" y="92" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="700" fill="${subColor}" letter-spacing="0.3">${escapeXml(subText)}</text>
    
    ${taskProgressMarkup(progress, { running: isWorking, color: subColor })}
    <text x="12" y="162" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#f59e0b" letter-spacing="0.2">${escapeXml(modelDisplay)}</text>
    <text x="184" y="162" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#94a3b8" letter-spacing="0.2">${validPct == null ? "ctx —" : `est. ctx ${validPct}%`}</text>
    
    <rect x="12" y="172" width="172" height="7" rx="3.5" fill="#21262d"/>
    ${barWidth > 0 ? `<rect x="12" y="172" width="${barWidth}" height="7" rx="3.5" fill="${barColor}"/>` : ""}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function proceedIconData({ connected = true, hasAction = false } = {}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#262c36" stroke-width="2"/>
      <g transform="translate(98, 76)">
        <circle cx="0" cy="0" r="32" fill="#1c2128" stroke="#30363d" stroke-width="2"/>
        <path d="M-10 -2 L-3 6 L12 -8" fill="none" stroke="#64748b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#64748b" letter-spacing="1">PROCEED</text>
      <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (!hasAction) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#262d35" stroke-width="2"/>
      <g transform="translate(98, 76)">
        <circle cx="0" cy="0" r="32" fill="#1a2026" stroke="#334155" stroke-width="2"/>
        <path d="M-10 -2 L-3 6 L12 -8" fill="none" stroke="#475569" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#64748b" letter-spacing="1">PROCEED</text>
      <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#475569" letter-spacing="0.8">NO PENDING</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgProceed" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#064e3b"/>
        <stop offset="100%" stop-color="#022c22"/>
      </linearGradient>
      <filter id="glowGreen" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgProceed)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#10b981" stroke-width="3" filter="url(#glowGreen)"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="#10b981" filter="url(#glowGreen)"/>
      <path d="M-10 -2 L-3 6 L12 -8" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="16" font-weight="900" fill="#34d399" letter-spacing="1">PROCEED</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#6ee7b7" letter-spacing="0.8">APPROVE PLAN</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function cancelIconData({ connected = true, isRunning = false } = {}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#262c36" stroke-width="2"/>
      <g transform="translate(98, 76)">
        <circle cx="0" cy="0" r="32" fill="#1c2128" stroke="#30363d" stroke-width="2"/>
        <path d="M-8 -8 L8 8 M8 -8 L-8 8" fill="none" stroke="#64748b" stroke-width="4.5" stroke-linecap="round"/>
      </g>
      <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#64748b" letter-spacing="1">STOP</text>
      <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (!isRunning) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#13161a"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#262d35" stroke-width="2"/>
      <g transform="translate(98, 76)">
        <circle cx="0" cy="0" r="32" fill="#1a2026" stroke="#334155" stroke-width="2"/>
        <path d="M-8 -8 L8 8 M8 -8 L-8 8" fill="none" stroke="#475569" stroke-width="4.5" stroke-linecap="round"/>
      </g>
      <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#64748b" letter-spacing="1">STOP</text>
      <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#475569" letter-spacing="0.8">IDLE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgCancel" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#450a0a"/>
        <stop offset="100%" stop-color="#1c0404"/>
      </linearGradient>
      <filter id="glowRed" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgCancel)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#ef4444" stroke-width="3" filter="url(#glowRed)"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="#ef4444" filter="url(#glowRed)"/>
      <path d="M-8 -8 L8 8 M8 -8 L-8 8" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="16" font-weight="900" fill="#ffffff" letter-spacing="1">STOP</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#fca5a5" letter-spacing="0.8">CANCEL TASK</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function attentionIconData(count = 0) {
  const hasAlert = count > 0;
  const countStr = count > 9 ? "9+" : String(count);
  const color = hasAlert ? "#f59e0b" : "#64748b";
  const bgGradStart = hasAlert ? "#451a03" : "#0f172a";
  const bgGradEnd = hasAlert ? "#1c0b02" : "#020617";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgAttn" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradStart}"/>
        <stop offset="100%" stop-color="${bgGradEnd}"/>
      </linearGradient>
      ${hasAlert ? `
      <filter id="glowOrange" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>` : ""}
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgAttn)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${color}" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="${color}" ${hasAlert ? 'filter="url(#glowOrange)"' : ""}/>
      <text x="0" y="9" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="28" font-weight="900" fill="#ffffff">!</text>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">${hasAlert ? `${countStr} PENDING` : 'ALL CLEAR'}</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${hasAlert ? '#fcd34d' : '#94a3b8'}" letter-spacing="0.8">ATTENTION</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function subagentsIconData(count = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgSub" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0c4a6e"/>
        <stop offset="100%" stop-color="#082f49"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgSub)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#0284c7" stroke-width="2"/>
    <g transform="translate(98, 72)">
      <rect x="-30" y="-18" width="60" height="36" rx="18" fill="#0284c7"/>
      <text x="0" y="8" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="22" font-weight="900" fill="#ffffff">${count}</text>
    </g>
    <text x="98" y="140" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="900" fill="#ffffff" letter-spacing="1">SUBAGENTS</text>
    <text x="98" y="160" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#7dd3fc" letter-spacing="0.8">ACTIVE WORKERS</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function planIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgPlan" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#312e81"/>
        <stop offset="100%" stop-color="#1e1b4b"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgPlan)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#6366f1" stroke-width="2"/>
    <g transform="translate(98, 70)">
      <rect x="-24" y="-30" width="48" height="60" rx="8" fill="#4338ca" stroke="#818cf8" stroke-width="2"/>
      <line x1="-14" y1="-15" x2="14" y2="-15" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round"/>
      <line x1="-14" y1="-3" x2="14" y2="-3" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round"/>
      <line x1="-14" y1="9" x2="6" y2="9" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round"/>
    </g>
    <text x="98" y="145" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">VIEW PLAN</text>
    <text x="98" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#a5b4fc" letter-spacing="0.8">OPEN IN VS CODE</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function walkthroughIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgWalk" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4c1d95"/>
        <stop offset="100%" stop-color="#2e1065"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgWalk)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#8b5cf6" stroke-width="2"/>
    <g transform="translate(98, 70)">
      <circle cx="0" cy="0" r="28" fill="#6d28d9" stroke="#a78bfa" stroke-width="2"/>
      <path d="M-8 -2 L-2 4 L10 -6" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="98" y="145" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">SUMMARY</text>
    <text x="98" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#c4b5fd" letter-spacing="0.8">WALKTHROUGH</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function newSessionIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgNew" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
      <linearGradient id="iconNew" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#a855f7"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgNew)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#334155" stroke-width="2"/>
    <g transform="translate(98, 74)">
      <circle cx="0" cy="0" r="30" fill="url(#iconNew)"/>
      <path d="M0 -12 L0 12 M-12 0 L12 0" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <text x="98" y="145" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">NEW SESSION</text>
    <text x="98" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#cbd5e1" letter-spacing="0.8">START CHAT</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function hudIconData({
  status = "idle",
  title = "Ready",
  elapsed = "",
  connected = true
}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgHudOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="24" fill="url(#bgHudOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#334155" stroke-width="2"/>
      <g transform="translate(98, 42)">
        <rect x="-40" y="-13" width="80" height="26" rx="13" fill="#1e293b"/>
        <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="#94a3b8" letter-spacing="1.2">HUD</text>
      </g>
      <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="18" font-weight="900" fill="#64748b" letter-spacing="0.5">OFFLINE</text>
      <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="700" fill="#ef4444" letter-spacing="0.8">BRIDGE OFF</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const st = String(status || "").toUpperCase();
  let pillText = "IDLE";
  let pillBg = "#1e293b";
  let pillBorder = "#334155";
  let pillCol = "#94a3b8";
  let strokeCol = "#1e293b";

  if (st === "PLANNING") {
    pillText = "PLANNING";
    pillBg = "#312e81";
    pillBorder = "#6366f1";
    pillCol = "#c7d2fe";
    strokeCol = "#6366f1";
  } else if (st === "EXECUTING" || st === "WORKING" || st === "RUNNING") {
    pillText = "EXECUTING";
    pillBg = "#0369a1";
    pillBorder = "#0284c7";
    pillCol = "#bae6fd";
    strokeCol = "#0ea5e9";
  } else if (st === "WAITING" || st === "ATTENTION") {
    pillText = "WAITING";
    pillBg = "#78350f";
    pillBorder = "#d97706";
    pillCol = "#fde68a";
    strokeCol = "#f59e0b";
  } else if (st === "ERROR") {
    pillText = "ERROR";
    pillBg = "#7f1d1d";
    pillBorder = "#dc2626";
    pillCol = "#fecaca";
    strokeCol = "#ef4444";
  }

  const isWorking = pillText === "PLANNING" || pillText === "EXECUTING";
  const timerText = elapsed && elapsed !== "0s" ? elapsed : (isWorking ? "ACTIVE" : "STANDBY");
  const cleanTitle = escapeXml(title.length > 20 ? `${title.slice(0, 19)}…` : title);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgHud" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
      <filter id="glowHud" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgHud)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${strokeCol}" stroke-width="${isWorking ? 2.5 : 2}" ${isWorking ? 'filter="url(#glowHud)"' : ''}/>

    <!-- Status Pill -->
    <g transform="translate(98, 40)">
      <rect x="-56" y="-14" width="112" height="28" rx="14" fill="${pillBg}" stroke="${pillBorder}" stroke-width="1.5"/>
      <circle cx="-40" cy="0" r="4" fill="${pillCol}"/>
      <text x="6" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="${pillCol}" letter-spacing="1">${pillText}</text>
    </g>

    <!-- Center Session Title -->
    <text x="98" y="96" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="800" fill="#f8fafc" letter-spacing="0.3">${cleanTitle}</text>

    <!-- Bottom Timer / Standby -->
    <g transform="translate(98, 154)">
      <rect x="-52" y="-13" width="104" height="26" rx="13" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
      <text x="0" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#94a3b8" letter-spacing="0.8">${timerText}</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function slashIconData(command) {
  let title = "/CMD";
  let sub = "COMMAND";
  let col = "#38bdf8";
  let bgStart = "#0c4a6e";
  let bgEnd = "#082f49";
  let icon = "";

  if (command === "boost") {
    title = "/BOOST";
    sub = "DEEP THINKING";
    col = "#a855f7";
    bgStart = "#3b0764";
    bgEnd = "#1e053a";
    icon = `<path d="M102 54 L86 78 L98 78 L94 98 L110 74 L98 74 Z" fill="${col}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>`;
  } else if (command === "grillme") {
    title = "/GRILL-ME";
    sub = "ALIGN PLAN";
    col = "#f59e0b";
    bgStart = "#451a03";
    bgEnd = "#1c0b02";
    icon = `<path d="M84 62 h28 a10 10 0 0 1 10 10 v12 a10 10 0 0 1 -10 10 h-16 l-8 8 v-8 h-4 a10 10 0 0 1 -10 -10 v-12 a10 10 0 0 1 10 -10 z" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="92" cy="74" r="2" fill="#ffffff"/>
            <circle cx="98" cy="74" r="2" fill="#ffffff"/>
            <circle cx="104" cy="74" r="2" fill="#ffffff"/>`;
  } else if (command === "goal") {
    title = "/GOAL";
    sub = "AUTONOMOUS";
    col = "#10b981";
    bgStart = "#064e3b";
    bgEnd = "#022c22";
    icon = `<circle cx="98" cy="74" r="18" fill="none" stroke="${col}" stroke-width="3"/>
            <circle cx="98" cy="74" r="10" fill="none" stroke="#34d399" stroke-width="2.5"/>
            <circle cx="98" cy="74" r="4" fill="#ffffff"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgSlash_${command}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgStart}"/>
        <stop offset="100%" stop-color="${bgEnd}"/>
      </linearGradient>
      <filter id="glowSlash_${command}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgSlash_${command})"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${col}" stroke-width="2"/>

    <g transform="translate(98, 36)">
      <rect x="-38" y="-12" width="76" height="24" rx="12" fill="#0f172a" stroke="${col}" stroke-width="1.2"/>
      <text x="0" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="900" fill="${col}" letter-spacing="1">SLASH</text>
    </g>

    <g filter="url(#glowSlash_${command})">
      ${icon}
    </g>

    <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="16" font-weight="900" fill="#ffffff" letter-spacing="1">${title}</text>
    <text x="98" y="158" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#94a3b8" letter-spacing="0.8">${sub}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function formatTokenCount(num) {
  if (num === null || num === undefined || !Number.isFinite(num)) return "0";
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 10000) {
    return `${Math.round(num / 1000)}k`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return String(num);
}

function tokensIconData(tokenUsage, connected = true) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOffTokensAgy" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="24" fill="url(#bgOffTokensAgy)"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#2c333a" stroke-width="2"/>
      <text x="98" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#8a96a3" letter-spacing="1">EST. TOKENS</text>
      <text x="98" y="118" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (!tokenUsage) return textCard("EST. TOKENS", "—", "No transcript data", connected);
  const total = tokenUsage?.total?.totalTokens ?? tokenUsage?.totalTokens ?? 0;
  const last = tokenUsage?.last?.totalTokens ?? tokenUsage?.last?.inputTokens ?? 0;
  const contextWindow = tokenUsage?.modelContextWindow || tokenUsage?.contextWindow || null;
  const pct = contextWindow && Number.isFinite(tokenUsage?.usedPercent) ? tokenUsage.usedPercent : null;

  const totalStr = formatTokenCount(total);
  const lastStr = last > 0 ? `+${formatTokenCount(last)}` : "—";
  const pctColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#3b82f6";
  const barWidth = pct == null ? 0 : Math.max(0, Math.round((pct / 100) * 128));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgTokensAgy" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#161b22"/>
        <stop offset="100%" stop-color="#0a0d10"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgTokensAgy)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#21262d" stroke-width="2"/>

    <g transform="translate(98, 36)">
      <rect x="-44" y="-13" width="88" height="26" rx="13" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="#94a3b8" letter-spacing="1">EST. TOKENS</text>
    </g>

    <text x="98" y="96" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="30" font-weight="900" fill="#f8fafc" letter-spacing="0.5">${totalStr}</text>
    <text x="98" y="122" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b" letter-spacing="0.8">LAST: <tspan fill="#38bdf8" font-weight="800">${lastStr}</tspan></text>

    <!-- Context Window Bar -->
    <g transform="translate(34, 142)">
      <rect x="0" y="0" width="128" height="8" rx="4" fill="#21262d"/>
      <rect x="0" y="0" width="${barWidth}" height="8" rx="4" fill="${pctColor}"/>
    </g>
    <text x="98" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="${pctColor}" letter-spacing="0.6">${pct == null ? "CONTEXT UNKNOWN" : `${pct}% EST. CONTEXT`}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function ack(message) {
  send({
    code: 0,
    cmd: message.cmd,
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: message.active,
    param: message.param || {}
  });
}

function sendSvgState(instance, dataUrl) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (!instance.active || instance.lastDisplay === dataUrl) return;
  instance.lastDisplay = dataUrl;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: dataUrl,
          showtext: false,
          textData: ""
        }
      ]
    }
  });
}

function setTaskDisplay(instance, path, text) {
  const digest = `path:${path}:${text}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 2,
        path,
        showtext: true,
        textData: text
      }]
    }
  });
}

function renderInstance(instance) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (!instance.active) return;
  const slot = taskSlot(instance.uuid);
  const slots = latestState?.slots || [];
  const activeTasks = latestState?.activeTasks || [];

  if (slot !== null) {
    if (!latestState?.connected) {
      sendSvgState(instance, sessionCardIconData({
        headerLeft: "AGY",
        headerRight: `Session ${slot + 1}`,
        connected: false
      }));
      return;
    }
    const task = activeTasks[slot] || slots[slot];
    if (!task?.threadKey) {
      sendSvgState(instance, sessionCardIconData({
        headerLeft: "AGY",
        headerRight: `Session ${slot + 1}`,
        connected: true,
        empty: true
      }));
      return;
    }
    const startTime = task.threadKey ? sessionStartTimes.get(task.threadKey) : null;
    const elapsed = startTime ? formatElapsed(Date.now() - startTime) : "";
    const displayStatus = task.status || task.agentStatus || "idle";
    sendSvgState(instance, sessionCardIconData({
      headerLeft: "AGY",
      headerRight: `Session ${slot + 1}`,
      title: task.title || "Untitled",
      status: displayStatus,
      elapsed,
      model: task.model || null,
      ctxPct: task.ctxPct ?? null,
      progress: task.progress,
      connected: true,
      empty: false
    }));
    return;
  }

  const name = actionName(instance.uuid);
  if (!name) return;

  if (["boost", "grillme", "goal"].includes(name)) {
    sendSvgState(instance, unavailableIcon());
    return;
  }

  if (name === "steer") {
    sendSvgState(instance, textCard("SEND QUEUED NOW", "SEND NOW", latestState?.desktopControls?.steer ? "One queued message" : "Select one queued message", Boolean(latestState?.applicationConnected)));
  } else if (["reject", "pin", "submit", "mic", "model", "fork", "reasoning", "prompt_test", "prompt_review", "prompt_commit"].includes(name)) {
    sendSvgState(instance, textCard("ANTIGRAVITY", ACTION_LABELS[name], name === "reasoning" ? (latestState?.reasoningEffort || "Model options") : name === "submit" ? "Send composer text" : name === "fork" && !latestState?.desktopControls?.fork ? "Unavailable here" : "Selected task", Boolean(latestState?.applicationConnected)));
  } else if (name === "tokens") {
    const connected = Boolean(latestState?.connected);
    const tokenUsage = latestState?.tokenUsage || null;
    sendSvgState(instance, tokensIconData(tokenUsage, connected));
  } else if (name === "proceed" || name === "approve") {
    const connected = Boolean(latestState?.applicationConnected);
    const hasAction = connected && Boolean(latestState?.desktopControls?.approve);
    sendSvgState(instance, proceedIconData({ connected, hasAction }));
  } else if (name === "cancel" || name === "stop") {
    const connected = Boolean(latestState?.applicationConnected);
    const isRunning = connected && Boolean(latestState?.desktopControls?.stop);
    sendSvgState(instance, cancelIconData({ connected, isRunning }));
  } else if (name === "attention") {
    sendSvgState(instance, attentionIconData(latestState?.pendingAttentionCount || 0));
  } else if (name === "subagents") {
    sendSvgState(instance, subagentsIconData(latestState?.subagentsCount || 0));
  } else if (name === "plan") {
    sendSvgState(instance, planIconData());
  } else if (name === "walkthrough") {
    sendSvgState(instance, walkthroughIconData());
  } else if (name === "usage") {
    sendSvgState(instance, usageIconData(latestState?.usage));
  } else if (name === "usage5h") {
    const usage = latestState?.connected ? latestState.usage : null;
    const { fiveHour } = usageRemaining(usage);
    const window = usage?.windows?.find((item) => item?.kind === "five-hour");
    sendSvgState(instance, singleUsageIconData({
      header: "AGY 5H",
      remaining: fiveHour,
      resetsAt: window?.resetsAt || null,
      connected: Boolean(latestState?.connected)
    }));
  } else if (name === "usageweekly") {
    const usage = latestState?.connected ? latestState.usage : null;
    const { weekly } = usageRemaining(usage);
    const window = usage?.windows?.find((item) => item?.kind === "weekly");
    sendSvgState(instance, singleUsageIconData({
      header: "AGY WK",
      remaining: weekly,
      resetsAt: window?.resetsAt || null,
      connected: Boolean(latestState?.connected)
    }));
  } else if (name === "new") {
    sendSvgState(instance, newSessionIconData());
  } else if (name === "navigate") {
    if (!latestState?.connected) {
      sendSvgState(instance, sessionCardIconData({
        headerLeft: "AGY",
        headerRight: "Latest",
        connected: false
      }));
      return;
    }
    const latestTask = activeTasks[0] || slots[0];
    if (!latestTask?.threadKey) {
      sendSvgState(instance, sessionCardIconData({
        headerLeft: "AGY",
        headerRight: "Latest",
        connected: true,
        empty: true
      }));
      return;
    }
    const startTime = latestTask?.threadKey ? sessionStartTimes.get(latestTask.threadKey) : null;
    const elapsed = startTime ? formatElapsed(Date.now() - startTime) : "";
    const displayStatus = latestTask.status || latestTask.agentStatus || "idle";
    sendSvgState(instance, sessionCardIconData({
      headerLeft: "AGY",
      headerRight: "Latest",
      title: latestTask.title || "Untitled",
      status: displayStatus,
      elapsed,
      model: latestTask.model || null,
      ctxPct: latestTask.ctxPct ?? null,
      progress: latestTask.progress,
      connected: true,
      empty: false
    }));
  } else if (name === "hud") {
    const latestTask = latestState?.lastTask || null;
    const startTime = latestTask?.threadKey ? sessionStartTimes.get(latestTask.threadKey) : null;
    const elapsed = startTime ? formatElapsed(Date.now() - startTime) : "";
    sendSvgState(instance, hudIconData({
      status: latestTask?.agentStatus || latestTask?.status || "unknown",
      title: latestTask?.title || "Select a task",
      elapsed,
      connected: Boolean(latestState?.connected)
    }));
  } else if (name === "boost") {
    sendSvgState(instance, slashIconData("boost"));
  } else if (name === "grillme") {
    sendSvgState(instance, slashIconData("grillme"));
  } else if (name === "goal") {
    sendSvgState(instance, slashIconData("goal"));
  }
}

function renderAll() {
  const slots = latestState?.slots || [];
  const activeTasks = latestState?.activeTasks || [];
  updateSessionRunningTimes(slots, activeTasks);
  for (const instance of instances.values()) {
    renderInstance(instance);
  }
}

const feed = bridgeFeed({ component: "antigravity", url: BRIDGE_URL, poll: pollBridgeState, onState: state => { latestState = state;  renderAll(); } });
function connectBridgeWs() { feed.start(); }

async function pollBridgeState() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    latestState = await requestLocal("/state");
  } catch (err) {
    latestState = { connected: false, error: err.message, slots: [] };
  } finally {
    pollInFlight = false;
    renderAll();
  }
}

async function clickSlot(slot) {
  const threadId = latestState?.slots?.[slot]?.threadKey;
  if (!threadId) throw new Error("No session in this slot");
  return requestLocal(`/task/${slot}/click`, { method: "POST", body: JSON.stringify({ threadId }) });
}
async function invokeAction(name, param = {}) {
  return requestLocal(`/action/${name}`, { method: "POST", body: JSON.stringify({ threadId: latestState?.selectedThreadId, ...param }) });
}
async function invoke(instance, pressed) {
  if (!pressed) return;
  const slot = taskSlot(instance.uuid);
  if (slot !== null) return clickSlot(slot);
  const name = actionName(instance.uuid);

  if (["usage", "usage5h", "usageweekly", "tokens", "hud", "subagents"].includes(name)) return requestLocal("/focus", { method: "POST" });
  if (name === "navigate") return clickSlot(0);
  if (name) await invokeAction(name);
}

function addInstance(message) {
  const context = contextOf(message);
  const existing = instances.get(context);
  const instance = existing || {
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: true,
    lastDisplay: null
  };
  instance.active = true;
  instances.set(context, instance);
  renderInstance(instance);
  return instance;
}

async function handleInspector(message) {
  try {
    const { path, method = "GET", body } = message.payload;
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || typeof body === "string" && body.length > 65536) throw new Error("Invalid inspector request");
    const target = new URL(path, "http://localhost");
    const allowed = ["GET /state", "POST /focus"];
    if (!allowed.includes(`${method} ${target.pathname}`)) throw new Error("Unsupported inspector operation");
    const data = await requestLocal(target.pathname + target.search, { method, body, signal: AbortSignal.timeout(110000) });
    inspectorReply(send, message, { data });
  } catch (error) { inspectorReply(send, message, { error: error.message }); }
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (message.cmd === "sendToPlugin" && message.payload?.type === "localApi") {
    ack(message); void handleInspector(message); return;
  }

  if (message.cmd === "add" || message.cmd === "paramfromapp") {
    addInstance(message);
    ack(message);
    return;
  }

  if (message.cmd === "setactive") {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    instance.active = Boolean(message.active);
    if (instance.active) {
      instance.lastDisplay = null;
      renderInstance(instance);
    }
    ack(message);
    return;
  }

  if (message.cmd === "clear") {
    for (const item of message.param || []) {
      instances.delete(contextOf(item));
    }
    ack(message);
    return;
  }

  if (message.cmd === "run") {
    ack(message);
    return;
  }

  if (["dialdown", "dialup", "dialrotate"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    if (actionName(instance.uuid) === "navigate") {
      if (message.cmd === "dialdown") {
        void clickSlot(0).catch(error => reportActionError(send, instance, error));
      } else if (message.cmd === "dialrotate") {
        const ticks = encoderTicks(message);
        if (!ticks) { ack(message); return; }
        const direction = ticks > 0 ? "down" : "up";
        void requestLocal(`/scroll/${direction}`, { method: "POST", body: JSON.stringify({ threadId: latestState?.selectedThreadId }) }).catch(error => reportActionError(send, instance, error));
      }
    }
    ack(message);
    return;
  }

  if (["keydown", "keyup"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    void invoke(instance, message.cmd !== "keyup").catch(error => reportActionError(send, instance, error));
    ack(message);
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  const hostSocket = new WebSocket(HOST_URL);
  socket = hostSocket;

  hostSocket.on("open", () => {
    if (socket !== hostSocket) return;
    send({ code: 0, cmd: "connected", uuid: PLUGIN_UUID });
    invalidateDisplays(instances);
    renderAll();
    connectBridgeWs();
    void pollBridgeState();
  });

  hostSocket.on("message", raw => { if (socket === hostSocket) handleMessage(raw); });

  hostSocket.on("close", () => {
    if (socket !== hostSocket) return;
    feed.stop();
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
  });

  hostSocket.on("error", (err) => {
    console.error("WS error:", err);
    hostSocket.close();
  });
}

const renderTimer = setInterval(renderAll, 1000);
renderTimer.unref();

connect();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(reconnectTimer);
    clearInterval(renderTimer);
    feed.stop();
    socket?.close();
    process.exit(0);
  });
}
