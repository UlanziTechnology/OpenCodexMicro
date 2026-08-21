import { discoverDebugPort, fetchJson } from "./platform.mjs";
import WebSocket from "ws";
import { localThreadKey } from "./thread-key.mjs";

const USAGE_REFRESH_MS = Math.max(
  15000,
  Number(process.env.CODEX_KEYBOARD_USAGE_REFRESH_SECONDS || 600) * 1000
);
const DEVICE_STATE = {
  type: "codex-micro-device-state-changed",
  state: { status: "connected", error: null, battery: { percentage: 100, isCharging: true } }
};
const MICRO_ACTION_KEYS = Object.freeze({
  fast: "ACT06",
  approve: "ACT07",
  reject: "ACT08",
  fork: "ACT09",
  mic: "ACT10",
  submit: "ACT12"
});
const MODEL_PRESETS = Object.freeze({
  "model-sol-high": Object.freeze({ model: "gpt-5.6-sol", displayName: "5.6 Sol", effort: "high" }),
  "model-luna-max": Object.freeze({ model: "gpt-5.6-luna", displayName: "5.6 Luna", effort: "max" }),
  "model-sol-medium": Object.freeze({ model: "gpt-5.6-sol", displayName: "5.6 Sol", effort: "medium" })
});
const RENDERER_ACTIONS = new Set(["pin", "new", ...Object.keys(MODEL_PRESETS)]);
const PIN_ACTION_LABELS = Object.freeze([
  "Pin chat",
  "Unpin chat",
  "置顶聊天",
  "取消置顶聊天",
  "釘選聊天",
  "取消釘選聊天"
]);
const NEW_ACTION_LABELS = Object.freeze([
  "New task",
  "New chat",
  "New conversation",
  "新对话",
  "新對話",
  "新建任务",
  "新建聊天",
  "新增任務",
  "新增聊天"
]);
const STEER_ACTION_LABELS = Object.freeze([
  "Steer",
  "调整方向",
  "調整方向",
  "引導"
]);

export function rendererActionExpression(action) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const visible = (element) => element && element.offsetParent !== null;
    let target = null;
    if (action === "pin") {
      const active = document.querySelector(
        "[data-app-action-sidebar-thread-active=true]"
      ) ?? document.querySelector(
        "[data-app-action-sidebar-thread-id][aria-current=page]"
      );
      const labels = new Set(${JSON.stringify(PIN_ACTION_LABELS)});
      target = active && [...active.querySelectorAll("button")].find(
        (button) => visible(button) && labels.has(button.getAttribute("aria-label"))
      );
    } else if (action === "new") {
      const sidebarAnchor = document.querySelector(
        "[data-app-action-sidebar-project-create]"
      ) ?? document.querySelector("[data-app-action-sidebar-thread-id]");
      const sidebar = sidebarAnchor?.closest("nav");
      const structuralCandidates = [...(
        sidebar?.querySelectorAll(
          ".sidebar-item.relative > button.sidebar-item"
        ) ?? []
      )].filter(visible);
      if (structuralCandidates.length === 1) {
        target = structuralCandidates[0];
      } else {
        const labels = new Set(${JSON.stringify(NEW_ACTION_LABELS)});
        const buttons = [...document.querySelectorAll("button")].filter(visible);
        target = buttons.find((button) => [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          (button.innerText || "").trim()
        ].some((label) => labels.has(label)));
      }
    }
    if (!target) return false;
    target.click();
    return true;
  })()`;
}

export function modelPreset(action) {
  const preset = MODEL_PRESETS[action];
  if (!preset) throw new Error(`Unknown Codex model preset: ${action}`);
  return preset;
}

export function composerSteerExpression() {
  return `(() => {
    const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
      .find((element) => element.offsetParent !== null);
    if (!editor) throw new Error("Codex composer is not available");
    editor.focus();
    const labels = new Set(${JSON.stringify(STEER_ACTION_LABELS)});
    const steer = [...document.querySelectorAll('button')]
      .find((element) =>
        element.offsetParent !== null && [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          (element.innerText || "").trim()
        ].some((label) => labels.has(label))
      );
    if (!steer) return false;
    steer.click();
    return true;
  })()`;
}

const ENABLE_EXPRESSION = `(async () => {
  const gateName = "3207467860";
  const statsig = globalThis.__STATSIG__;
  const clients = [...new Set([statsig?.firstInstance, ...Object.values(statsig?.instances ?? {})].filter(Boolean))];
  for (const client of clients) {
    if (client.overrideAdapter?.__codexKeyboardGate !== gateName) {
      const original = client.overrideAdapter ?? {};
      client.overrideAdapter = new Proxy(original, {
        get(target, property) {
          if (property === "__codexKeyboardGate") return gateName;
          if (property === "getGateOverride") return (gate, user, options) => {
            if (gate?.name === gateName) return { ...gate, value: true };
            const fallback = Reflect.get(target, property, target);
            return typeof fallback === "function" ? fallback.call(target, gate, user, options) : gate;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
    client._memoCache = {};
    client.$emt?.({ name: "values_updated" });
  }
  const urls = [...new Set([
    ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
  for (const url of urls.filter((url) => /vscode-api|codex-micro|app-initial/.test(url)).slice(0, 120)) {
    try {
      const namespace = await import(url);
      const bus = Object.values(namespace).find((candidate) =>
        candidate && typeof candidate === "object" &&
        candidate.handlers instanceof Map &&
        (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
      );
      if (!bus) continue;
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
      return { ready: true, clients: clients.length };
    } catch {}
  }
  return { ready: clients.length > 0, clients: clients.length };
})()`;

const SNAPSHOT_EXPRESSION = `(async () => {
  const startedAt = performance.now();
  const root = document.getElementById("root");
  const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith("__reactContainer$"));
  if (!root || !reactKey) throw new Error("Codex React root was not found");
  const sourceKey = Symbol.for("codex-keyboard-micro-snapshot-source");
  const validSlots = (slots) =>
    Array.isArray(slots) && slots.length === 6 &&
    slots.every((slot, index) => slot?.id === index);
  const readSource = (source) => {
    if (!source || source.root !== root || !source.node?.store) {
      throw new Error("Cached Codex Micro source is stale");
    }
    const slots = source.node.store.get(
      source.resolver.resolve(source.node, source.contextMap)
    );
    if (!validSlots(slots)) throw new Error("Cached Codex Micro slots are stale");
    return slots;
  };

  let source = globalThis[sourceKey];
  let found = null;
  let queryClients = new Set();
  let cacheHit = false;
  if (source) {
    try {
      found = readSource(source);
      queryClients = new Set(source.queryClients ?? []);
      cacheHit = true;
    } catch {
      delete globalThis[sourceKey];
      source = null;
    }
  }

  if (!found) {
    const urls = [...new Set([
      ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name)
    ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
    const slotSignalsUrl = urls.find((url) => url.includes("/assets/codex-micro-slot-signals-"));
    if (!slotSignalsUrl) throw new Error("Codex Micro slot signals are not loaded");

    const namespaces = [];
    for (const url of urls) {
      try { namespaces.push(await import(url)); } catch {}
    }
    const exportedValues = namespaces.flatMap((namespace) => Object.values(namespace));
    const bus = exportedValues.find((candidate) =>
      candidate && typeof candidate === "object" && candidate.handlers instanceof Map &&
      (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
    );
    if (bus) {
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      if ((bus.handlers.get("codex-micro-hid-event")?.size ?? 0) === 0) {
        (bus.dispatchHostMessage ?? bus.dispatchMessage).call(bus, ${JSON.stringify(DEVICE_STATE)});
      }
    }

    const signals = await import(slotSignalsUrl);
    const resolvers = Object.values(signals).filter((candidate) =>
      candidate && typeof candidate === "object" &&
      typeof candidate.resolve === "function" && typeof candidate.createSubscriberAtom === "function"
    );
    const queue = [root[reactKey]];
    const seen = new Set();
    queryClients = new Set();
    while (queue.length && seen.size < 30000 && !found) {
      const fiber = queue.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const values = [fiber.memoizedProps?.value];
      let dependency = fiber.dependencies?.firstContext;
      while (dependency) { values.push(dependency.memoizedValue); dependency = dependency.next; }
      for (const value of values) {
        if (
          value && typeof value.getQueryCache === "function" &&
          typeof value.getQueryData === "function"
        ) queryClients.add(value);
        if (!(value instanceof Map)) continue;
        for (const node of value.values()) {
          if (!node?.store || typeof node.store.get !== "function") continue;
          for (const resolver of resolvers) {
            try {
              const slots = node.store.get(resolver.resolve(node, value));
              if (validSlots(slots)) {
                found = slots;
                source = {
                  root,
                  node,
                  resolver,
                  contextMap: value,
                  queryClients: [...queryClients]
                };
                globalThis[sourceKey] = source;
                break;
              }
            } catch {}
          }
          if (found) break;
        }
        if (found) break;
      }
      queue.push(fiber.child, fiber.sibling);
    }
    if (!found) throw new Error("Codex Micro slot store was not found");
  }
  let usage = null;
  for (const queryClient of queryClients) {
    try {
      const query = queryClient.getQueryCache().getAll().find((candidate) =>
        JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
      );
      const now = Date.now();
      const updatedAt = Number(query?.state?.dataUpdatedAt) || 0;
      const refreshKey = Symbol.for("codex-keyboard-rate-limit-refresh-at");
      const lastAttempt = Number(globalThis[refreshKey]) || 0;
      if (
        query && typeof query.fetch === "function" &&
        now - updatedAt >= ${USAGE_REFRESH_MS} && now - lastAttempt >= ${USAGE_REFRESH_MS}
      ) {
        globalThis[refreshKey] = now;
        try { Promise.resolve(query.fetch()).catch(() => {}); } catch {}
      }
      const data = query?.state?.data;
      const rateLimit = data?.rate_limit;
      if (!rateLimit || typeof rateLimit !== "object") continue;
      const normalizeWindow = (window, role) => {
        if (!window || typeof window !== "object") return null;
        const usedPercent = Number(window.used_percent);
        if (!Number.isFinite(usedPercent)) return null;
        const seconds = Number(window.limit_window_seconds);
        const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
        const kind = minutes != null && Math.abs(minutes - 300) <= 1 ? "five-hour"
          : minutes != null && Math.abs(minutes - 10080) <= 1 ? "weekly"
            : "other";
        const used = Math.min(100, Math.max(0, usedPercent));
        return {
          id: kind === "other" ? role : kind,
          kind,
          usedPercent: used,
          remainingPercent: 100 - used,
          resetsAt: Number(window.reset_at) || null
        };
      };
      usage = {
        windows: [
          normalizeWindow(rateLimit.primary_window, "primary"),
          normalizeWindow(rateLimit.secondary_window, "secondary")
        ].filter(Boolean),
        observedAt: updatedAt || now
      };
      break;
    } catch {}
  }
  const active = document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
    ?? document.querySelector("[data-app-action-sidebar-thread-id][aria-current=page]");
  const activeThreadKey = document.querySelector("[data-above-composer-conversation-id]")
    ?.getAttribute("data-above-composer-conversation-id")
    ?? active?.getAttribute("data-app-action-sidebar-thread-id")
    ?? null;
  const normalizeThreadKey = (value) => String(value ?? "").replace(/^local:/, "");
  return {
    activeThreadKey,
    slots: found.map((slot) => ({
      id: slot.id,
      threadKey: slot.threadKey ?? null,
      title: slot.title ?? slot.thread?.title ?? slot.task?.title ?? null,
      status: slot.status ?? "idle",
      selected: Boolean(slot.selected) || Boolean(
        activeThreadKey && normalizeThreadKey(slot.threadKey) === normalizeThreadKey(activeThreadKey)
      )
    })),
    usage,
    bridgeSnapshot: {
      source: cacheHit ? "cache" : "discovery",
      durationMs: performance.now() - startedAt
    }
  };
})()`;

function selectMainTarget(targets) {
  const pages = targets.filter((target) =>
    target.type === "page" && target.webSocketDebuggerUrl && target.url?.startsWith("app://")
  );
  return pages.find((target) => {
    try { return new URL(target.url).pathname === "/index.html" && !new URL(target.url).search; }
    catch { return false; }
  }) ?? pages.find((target) => !/avatar-overlay|composition-surface/i.test(target.url || ""));
}

export class CodexCdpClient {
  socket = null;
  connectPromise = null;
  connectionGeneration = 0;
  nextId = 0;
  pending = new Map();
  lastSnapshot = null;

  constructor({
    discoverPort = discoverDebugPort,
    fetchTargets = fetchJson,
    createSocket = url => new WebSocket(url)
  } = {}) {
    this.discoverPort = discoverPort;
    this.fetchTargets = fetchTargets;
    this.createSocket = createSocket;
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    const generation = ++this.connectionGeneration;
    const operation = this.openConnection(generation);
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) this.connectPromise = null;
    }
  }

  async openConnection(generation) {
    const port = await this.discoverPort();
    const target = selectMainTarget(await this.fetchTargets(`http://127.0.0.1:${port}/json/list`));
    if (!target?.webSocketDebuggerUrl) throw new Error("Codex main renderer was not found");
    if (generation !== this.connectionGeneration) throw new Error("Codex bridge connection was cancelled");
    const socket = this.createSocket(target.webSocketDebuggerUrl);
    this.socket = socket;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out connecting to Codex"));
        }, 3000);
        const cleanup = () => {
          clearTimeout(timer);
          socket.off("open", onOpen);
          socket.off("error", onError);
        };
        const onOpen = () => { cleanup(); resolve(); };
        const onError = error => { cleanup(); reject(error); };
        socket.once("open", onOpen);
        socket.once("error", onError);
      });
      if (generation !== this.connectionGeneration || this.socket !== socket) {
        throw new Error("Codex bridge connection was cancelled");
      }
      socket.on("message", (raw) => this.handleMessage(String(raw)));
      socket.on("close", () => {
        if (this.socket === socket) this.disconnect();
      });
      socket.on("error", () => {
        if (this.socket === socket) this.disconnect();
      });
      await this.evaluate(ENABLE_EXPRESSION);
    } catch (error) {
      if (this.socket === socket) this.disconnect();
      throw error;
    }
  }

  async snapshot() {
    await this.connect();
    try {
      this.lastSnapshot = await this.evaluate(SNAPSHOT_EXPRESSION);
      return this.lastSnapshot;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  async clickAgent(slot) {
    await this.connect();
    const snapshot = this.lastSnapshot ?? await this.snapshot();
    const agent = snapshot.slots[slot];
    if (!agent?.threadKey) throw new Error(`Agent slot ${slot + 1} is empty`);
    return this.clickThreadKey(agent.threadKey, slot);
  }

  async clickThread(threadId, slot = 0) {
    await this.connect();
    return this.clickThreadKey(localThreadKey(threadId), slot);
  }

  async clickThreadKey(threadKey, slot) {
    // Use the same native HID path as Codex Micro. The DOM click introduced
    // perceptible navigation scheduling; it is now only a non-blocking fallback.
    try {
      await this.dispatchAgent(slot, threadKey, 1);
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        await this.dispatchAgent(slot, threadKey, 0);
        await this.activateThread(threadKey);
      })().catch(() => {});
    } catch {
      await this.activateThread(threadKey);
    }
  }

  async dispatchAgent(slot, threadKey, act) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key: `AG0${slot}`, act, slot, threadKey }
    }, "codex-micro-hid-event");
  }

  async dispatchAction(key, act) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key, act, slot: null, threadKey: null }
    }, "codex-micro-hid-event");
  }

  async dispatchNamedAction(action, pressed) {
    const key = MICRO_ACTION_KEYS[action];
    if (key) return this.dispatchAction(key, pressed ? 1 : 0);
    if (!RENDERER_ACTIONS.has(action)) {
      throw new Error(`Unsupported Codex bridge action: ${action}`);
    }
    if (!pressed) return true;
    return this.dispatchRendererAction(action);
  }

  async dispatchRendererAction(action) {
    await this.connect();
    if (MODEL_PRESETS[action]) {
      await this.dispatchModelPreset(action);
      return true;
    }
    const invoked = await this.evaluate(rendererActionExpression(action));
    if (!invoked) throw new Error(`Codex ${action} action is not available`);
    return true;
  }

  async dispatchModelPreset(action) {
    const preset = MODEL_PRESETS[action];
    if (!preset) throw new Error(`Unknown Codex model preset: ${action}`);
    const effortOrder = ["low", "medium", "high", "xhigh", "max"];
    const targetEffortIndex = effortOrder.indexOf(preset.effort);
    const readState = async () => {
      const state = await this.evaluate(`(() => {
        const visible = (element) => {
          const rect = element?.getBoundingClientRect?.();
          return element && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0));
        };
        const triggers = [...document.querySelectorAll("[data-codex-intelligence-trigger]")].filter(visible);
        if (triggers.length !== 1) return { error: \`Expected one visible intelligence trigger, found \${triggers.length}\` };
        return {
          text: String(triggers[0].textContent ?? "").replace(/\\s+/g, " ").trim(),
          effort: triggers[0].getAttribute("data-selected-reasoning-effort"),
          expanded: triggers[0].getAttribute("aria-expanded") === "true"
        };
      })()`);
      if (state?.error) throw new Error(state.error);
      return state;
    };
    const closeMenus = async () => {
      for (let attempt = 0; attempt < 3 && (await readState()).expanded; attempt += 1) {
        await this.pressRendererEscape();
      }
      if ((await readState()).expanded) throw new Error("Codex intelligence menu did not close");
    };
    const openMain = async () => {
      if (!(await readState()).expanded) {
        await this.clickRendererCandidates(
          '[...document.querySelectorAll("[data-codex-intelligence-trigger]")]',
          "Codex intelligence trigger"
        );
      }
      await this.waitForRenderer(`(() => {
        const visible = (element) => {
          const rect = element?.getBoundingClientRect?.();
          return element && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0));
        };
        return [...document.querySelectorAll('[role="menu"][data-state="open"]')].filter(
          (menu) => visible(menu) && (
            menu.querySelector("[data-model-picker-view-toggle]") ||
            menu.querySelector("[data-reasoning-slider]")
          )
        ).length === 1;
      })()`, "Codex intelligence menu");
      const toggleState = await this.evaluate(`(() => {
        const menus = [...document.querySelectorAll('[role="menu"][data-state="open"]')].filter(
          (menu) => menu.querySelector("[data-model-picker-view-toggle]") || menu.querySelector("[data-reasoning-slider]")
        );
        const toggles = menus.length === 1
          ? [...menus[0].querySelectorAll("[data-model-picker-view-toggle]")]
          : [];
        return {
          count: toggles.length,
          expanded: toggles[0]?.getAttribute("aria-expanded") === "true",
          rowCount: menus[0]?.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]').length ?? 0
        };
      })()`);
      if (toggleState.count === 0 && toggleState.rowCount === 2) return;
      if (toggleState.count !== 1) {
        throw new Error(`Expected one model picker view toggle, found ${toggleState.count}`);
      }
      if (!toggleState.expanded) {
        await this.clickRendererCandidates(
          `(() => {
            const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
              (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
            );
            return menu ? [...menu.querySelectorAll("[data-model-picker-view-toggle]")] : [];
          })()`,
          "model picker view toggle"
        );
      }
    };
    const rowExpression = (rowIndex) => `(() => {
      const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
        (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
      );
      const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
      return rows[${rowIndex}] ? [rows[${rowIndex}]] : [];
    })()`;
    const submenuInfo = async (rowIndex) => this.waitForRenderer(`(() => {
      const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
        (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
      );
      const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
      if (rows.length !== 2 || !rows[${rowIndex}]) return null;
      const submenu = document.getElementById(rows[${rowIndex}].getAttribute("aria-controls"));
      if (!submenu || submenu.getAttribute("data-state") !== "open") return null;
      return [...submenu.querySelectorAll('[role="menuitem"]')].map((item) => ({
        text: String(item.textContent ?? "").replace(/\\s+/g, " ").trim(),
        checked: Boolean(item.querySelector("svg"))
      }));
    })()`, "Codex model picker submenu");
    const identifyRows = async () => {
      const rowCount = await this.evaluate(`(() => {
        const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
          (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
        );
        return menu?.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]').length ?? 0;
      })()`);
      if (rowCount !== 2) throw new Error(`Expected two Codex model picker rows, found ${rowCount}`);
      let modelRowIndex = -1;
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        await openMain();
        await this.clickRendererCandidates(rowExpression(rowIndex), `model picker row ${rowIndex + 1}`);
        const items = await submenuInfo(rowIndex);
        if (items.filter((item) => item.text === preset.displayName).length === 1) {
          modelRowIndex = rowIndex;
        }
        await this.pressRendererEscape();
      }
      if (modelRowIndex < 0) throw new Error(`Codex model ${preset.displayName} is not available`);
      return { modelRowIndex, effortRowIndex: modelRowIndex === 0 ? 1 : 0 };
    };
    const selectEffort = async () => {
      const current = await readState();
      if (current.effort === preset.effort) return;
      const currentEffortIndex = effortOrder.indexOf(current.effort);
      if (currentEffortIndex < 0 || targetEffortIndex < 0) {
        throw new Error(`Unsupported Codex reasoning effort transition: ${current.effort} -> ${preset.effort}`);
      }
      await openMain();
      const { effortRowIndex } = await identifyRows();
      await openMain();
      await this.clickRendererCandidates(rowExpression(effortRowIndex), "reasoning effort row");
      const items = await submenuInfo(effortRowIndex);
      const checkedIndexes = items.flatMap((item, index) => item.checked ? [index] : []);
      if (items.length !== effortOrder.length || checkedIndexes.length !== 1 || checkedIndexes[0] !== currentEffortIndex) {
        throw new Error("Codex reasoning effort order or selected state changed");
      }
      await this.clickRendererCandidates(`(() => {
        const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
          (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
        );
        const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
        const submenu = rows[${effortRowIndex}]
          ? document.getElementById(rows[${effortRowIndex}].getAttribute("aria-controls"))
          : null;
        const items = submenu ? [...submenu.querySelectorAll('[role="menuitem"]')] : [];
        return items[${targetEffortIndex}] ? [items[${targetEffortIndex}]] : [];
      })()`, `reasoning effort ${preset.effort}`);
      await this.waitForRenderer(
        `document.querySelector("[data-codex-intelligence-trigger]")?.getAttribute("data-selected-reasoning-effort") === ${JSON.stringify(preset.effort)}`,
        `reasoning effort ${preset.effort}`
      );
    };
    const selectModel = async () => {
      if ((await readState()).text.includes(preset.displayName)) return;
      await openMain();
      const { modelRowIndex } = await identifyRows();
      await openMain();
      await this.clickRendererCandidates(rowExpression(modelRowIndex), "model row");
      const items = await submenuInfo(modelRowIndex);
      if (items.filter((item) => item.text === preset.displayName).length !== 1) {
        throw new Error(`Expected one available ${preset.displayName} model option`);
      }
      await this.clickRendererCandidates(`(() => {
        const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
          (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
        );
        const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
        const submenu = rows[${modelRowIndex}]
          ? document.getElementById(rows[${modelRowIndex}].getAttribute("aria-controls"))
          : null;
        return submenu
          ? [...submenu.querySelectorAll('[role="menuitem"]')].filter(
              (item) => String(item.textContent ?? "").replace(/\\s+/g, " ").trim() === ${JSON.stringify(preset.displayName)}
            )
          : [];
      })()`, `model ${preset.displayName}`);
      await this.waitForRenderer(
        `String(document.querySelector("[data-codex-intelligence-trigger]")?.textContent ?? "").includes(${JSON.stringify(preset.displayName)})`,
        `model ${preset.displayName}`
      );
    };

    try {
      await selectEffort();
      await selectModel();
      await selectEffort();
      const selected = await readState();
      if (!selected.text.includes(preset.displayName) || selected.effort !== preset.effort) {
        throw new Error(`Codex did not select ${preset.displayName} / ${preset.effort}`);
      }
      await closeMenus();
      return { model: preset.model, effort: preset.effort };
    } catch (error) {
      try { await closeMenus(); } catch {}
      throw error;
    }
  }

  async dispatchComposerSteer() {
    await this.connect();
    const clicked = await this.evaluate(composerSteerExpression());
    if (!clicked) throw new Error("Codex Steer action is not available");
  }

  async dispatchJoystick(direction, distance) {
    const angle = { up: 0.75, right: 0, down: 0.25, left: 0.5 }[direction];
    if (angle === undefined) throw new Error(`Unknown joystick direction: ${direction}`);
    return this.dispatchMicroMessage({
      type: "codex-micro-joystick-event",
      event: { angle, distance }
    }, "codex-micro-joystick-event");
  }

  async dispatchMicroMessage(message, requiredHandler) {
    return this.evaluate(`(async () => {
      const cacheKey = Symbol.for("codex-keyboard-micro-bus");
      const isMicroBus = (candidate) =>
        candidate && candidate.handlers instanceof Map &&
        (
          candidate.handlers.has(${JSON.stringify(requiredHandler)}) ||
          [...candidate.handlers.keys()].some((key) => String(key).startsWith("codex-micro-"))
        ) &&
        (
          typeof candidate.dispatchHostMessage === "function" ||
          typeof candidate.dispatchMessage === "function"
        );
      let bus = globalThis[cacheKey];
      if (!isMicroBus(bus)) {
        const urls = [...new Set([
          ...[...document.querySelectorAll("link[href],script[src]")].map((element) => element.href || element.src),
          ...performance.getEntriesByType("resource").map((entry) => entry.name)
        ])]
          .filter((url) => url.includes("/assets/") && url.endsWith(".js"));
        bus = null;
        for (const url of urls) {
          try {
            const namespace = await import(url);
            bus = Object.values(namespace).find(isMicroBus);
            if (bus) {
              globalThis[cacheKey] = bus;
              break;
            }
          } catch {}
        }
      }
      if (!bus) throw new Error("Codex Micro event bus was not found");
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      if ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0) {
        dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
      }
      // Never put Micro handler discovery on the physical key hot path. The
      // native event is dispatched immediately; clickAgent keeps a DOM
      // activation fallback in the background in case Codex has not installed
      // its handler yet.
      dispatch.call(bus, ${JSON.stringify(message)});
      return true;
    })()`);
  }

  async activateThread(threadKey) {
    return this.evaluate(`(async () => {
      const key = ${JSON.stringify(threadKey)};
      const normalize = (value) => String(value ?? "").replace(/^local:/, "");
      const current = () => document.querySelector("[data-above-composer-conversation-id]")
        ?.getAttribute("data-above-composer-conversation-id")
        ?? document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
          ?.getAttribute("data-app-action-sidebar-thread-id");
      if (normalize(current()) === normalize(key)) return true;
      const item = [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
        .find((el) => normalize(el.getAttribute("data-app-action-sidebar-thread-id")) === normalize(key));
      if (!item) throw new Error("Task is not loaded in the Codex sidebar");
      (item.querySelector("button,a,[role=button],[role=link]") ?? item).click();
      return true;
    })()`);
  }

  sendCommand(method, params, returnValue = false) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Codex bridge is disconnected"));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex runtime response timed out"));
      }, 7000);
      this.pending.set(id, { resolve, reject, timer, returnValue });
      this.socket.send(JSON.stringify({
        id,
        method,
        params
      }));
    });
  }

  evaluate(expression) {
    return this.sendCommand("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, true);
  }

  async clickRendererCandidates(candidatesExpression, description) {
    await this.evaluate(`(() => {
      const visible = (element) => {
        const rect = element?.getBoundingClientRect?.();
        return element && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0));
      };
      const candidates = [...(${candidatesExpression})].filter(visible);
      if (candidates.length !== 1) {
        throw new Error(\`Expected one ${description}, found \${candidates.length}\`);
      }
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        candidates[0].dispatchEvent(new EventType(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0,
          view: window
        }));
      }
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  async pressRendererEscape() {
    await this.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", code: "Escape", bubbles: true, cancelable: true
      }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  async waitForRenderer(expression, description) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await this.evaluate(expression);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) return pending.reject(new Error(message.error.message));
    if (message.result?.exceptionDetails) {
      return pending.reject(new Error(
        message.result.exceptionDetails.exception?.description
        ?? message.result.exceptionDetails.text
        ?? "Codex evaluation failed"
      ));
    }
    pending.resolve(
      pending.returnValue ? message.result?.result?.value : message.result
    );
  }

  disconnect() {
    this.connectionGeneration += 1;
    this.connectPromise = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try { socket.close(); } catch { socket.terminate?.(); }
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Codex bridge disconnected"));
    }
    this.pending.clear();
  }
}
