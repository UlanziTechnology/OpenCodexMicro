import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { resolveRspackModules } from "../src/bridge/rspack-modules.mjs";
import { CodexCdpClient, SNAPSHOT_EXPRESSION } from "../src/bridge/codex-cdp.mjs";

const ENTRY = "app://-/assets/43120.any-new-hash.js";
const slotsFactory = function() {
  return { slots: [], threadKeys: [], inactivityTimeoutMs: 0, voiceState: null };
};
const busFactory = function() {
  return { handlers: new Map(), dispatchHostMessage() {} };
};

function fixture() {
  const slots = Array.from({ length: 6 }, (_, id) => ({
    id, threadKey: `local:test-${id}`, status: id ? "idle" : "working"
  }));
  const resolver = {
    resolve() { return { atom: slots }; },
    createSubscriberAtom() {}
  };
  const messages = [];
  const bus = {
    handlers: new Map([["codex-micro-hid-event", new Set([() => {}])]]),
    dispatchHostMessage(message) { messages.push(message); }
  };
  const runtime = () => assert.fail("Discovery must not execute module factories");
  runtime.c = {
    signals: { exports: { arbitrary: resolver } },
    events: { exports: { renamed: bus } }
  };
  runtime.m = {
    signals: slotsFactory, events: busFactory,
    notInitialized: () => assert.fail("Uninitialized code must not be executed")
  };
  const importNamespace = async (url) => {
    assert.equal(url, ENTRY);
    return { __webpack_require__: runtime };
  };
  return { slots, resolver, bus, runtime, importNamespace, messages };
}

test("cold Rspack discovery reads initialized exports without module IDs or factories", async () => {
  const value = fixture();
  const result = await resolveRspackModules({ urls: [ENTRY], importNamespace: value.importNamespace });
  assert.deepEqual(result.resolvers, [value.resolver]);
  assert.equal(result.bus, value.bus);
  assert.deepEqual(value.messages, []);
});

test("Rspack discovery unwraps async exports with the runtime's own symbol", async () => {
  const value = fixture();
  value.runtime.aE = Symbol("runtime exports");
  value.runtime.c.signals.exports = {
    [value.runtime.aE]: value.runtime.c.signals.exports
  };
  const result = await resolveRspackModules({ urls: [ENTRY], importNamespace: value.importNamespace });
  assert.equal(result.resolvers[0], value.resolver);
});

test("entry candidates exclude remote and async scripts, with a fixed import limit", async () => {
  const urls = Array.from({ length: 20 }, (_, id) => `app://-/assets/${id}.hash.js`);
  const imports = [];
  const result = await resolveRspackModules({
    urls: [
      "https://example.com/assets/1.hash.js", "app://-/assets/async/2.hash.js",
      "app://-/assets/3.hash.js?extra", "invalid", ...urls, ...urls
    ],
    importNamespace: async (url) => { imports.push(url); return {}; }
  });
  assert.deepEqual(imports, urls.slice(0, 12));
  assert.deepEqual(result, { resolvers: [], bus: null });
});

test("entry import failures do not prevent finding another initialized runtime", async () => {
  const value = fixture();
  const result = await resolveRspackModules({
    urls: ["app://-/assets/missing.js", ENTRY],
    importNamespace: async (url) => {
      if (url !== ENTRY) throw new Error("Not available yet");
      return value.importNamespace(url);
    }
  });
  assert.equal(result.bus, value.bus);
});

test("delayed exports are rediscovered even when module count stays the same", async () => {
  const value = fixture();
  const cache = {};
  const options = { urls: [ENTRY], importNamespace: value.importNamespace, cache };
  value.runtime.c.signals.exports = {};
  assert.deepEqual((await resolveRspackModules(options)).resolvers, []);
  value.runtime.c.signals.exports = { renamed: value.resolver };
  assert.equal((await resolveRspackModules(options)).resolvers[0], value.resolver);
});

test("successful bindings are cached and rescanned when loaded modules change", async () => {
  const value = fixture();
  const cache = {};
  const options = { urls: [ENTRY], importNamespace: value.importNamespace, cache };
  const first = await resolveRspackModules(options);
  options.importNamespace = () => assert.fail("An initialized runtime must be reused");
  assert.equal(await resolveRspackModules(options), first);
  value.runtime.c.unrelated = { exports: {} };
  value.runtime.m.unrelated = function() {};
  assert.notEqual(await resolveRspackModules(options), first);
});

test("a replaced module cache is rediscovered even with an unchanged module count", async () => {
  const value = fixture();
  const cache = {};
  const options = { urls: [ENTRY], importNamespace: value.importNamespace, cache };
  const first = await resolveRspackModules(options);
  value.runtime.c = { ...value.runtime.c };
  assert.notEqual(await resolveRspackModules(options), first);
});

test("failed modules and throwing export getters do not abort discovery", async () => {
  const value = fixture();
  value.runtime.c.failed = { error: new Error("Module failed"), exports: {} };
  value.runtime.m.failed = slotsFactory;
  Object.defineProperty(value.runtime.c.signals.exports, "throwing", {
    enumerable: true, get() { throw new Error("Not initialized"); }
  });
  const result = await resolveRspackModules({ urls: [ENTRY], importNamespace: value.importNamespace });
  assert.equal(result.resolvers[0], value.resolver);
});

test("ambiguous buses are unavailable instead of choosing another event source", async () => {
  const value = fixture();
  value.runtime.c.events.exports.other = {
    handlers: new Map(), dispatchHostMessage() {}
  };
  const result = await resolveRspackModules({ urls: [ENTRY], importNamespace: value.importNamespace });
  assert.equal(result.bus, null);
});

async function snapshotFixture(format) {
  const value = fixture();
  const contextMap = new Map([[Symbol("scope"), { store: { get: (atom) => atom } }]]);
  const rootFiber = { memoizedProps: { value: contextMap } };
  const queryClient = {
    getQueryData() {},
    getQueryCache: () => ({ getAll: () => [{
      queryKey: ["rate-limit-status"],
      state: { dataUpdatedAt: Date.now(), data: {
        rate_limit: { primary_window: { used_percent: 31, limit_window_seconds: 18000 } }
      } }
    }] })
  };
  // Query providers can follow the slot provider in the committed tree.
  rootFiber.child = { memoizedProps: { value: queryClient } };
  rootFiber.stateNode = { current: rootFiber };
  const root = { __reactContainer$fixture: rootFiber };
  const slotUrl = "app://-/assets/codex-micro-slot-signals-old.js";
  const coreUrl = "app://-/assets/app-shared-old.js";
  const urls = format === "esm" ? [slotUrl, coreUrl] : [ENTRY];
  const context = vm.createContext({
    Map, URL, performance,
    document: {
      getElementById: () => root,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    importNamespace: async (url) => {
      if (url === slotUrl) return { arbitrary: value.resolver };
      if (url === coreUrl) return { bus: value.bus };
      return value.importNamespace(url);
    }
  });
  context[Symbol.for("codex-keyboard-renderer-resource-urls")] = urls;
  // Execute the full snapshot while replacing only the app-scheme loader.
  const expression = SNAPSHOT_EXPRESSION
    .replaceAll("(url) => import(url)", "importNamespace")
    .replaceAll("await import(slotSignalsUrl)", "await importNamespace(slotSignalsUrl)");
  const run = () => vm.runInContext(expression, context);
  return { first: await run(), second: await run(), context, run, value, rootFiber };
}

for (const format of ["esm", "rspack"]) {
  test(`cold ${format} snapshot returns live slots and usage with no warm source`, async () => {
    const result = await snapshotFixture(format);
    assert.equal(result.first.slots.filter((slot) => slot.threadKey).length, 6);
    assert.equal(result.first.usage.windows[0].remainingPercent, 69);
    assert.equal(result.first.bridgeSnapshot.source, "discovery");
    assert.equal(result.first.bridgeSnapshot.moduleFormat, format);
    assert.equal(result.second.bridgeSnapshot.source, "cache");
    assert.deepEqual(result.value.messages, []);
    vm.runInContext('delete globalThis[Symbol.for("codex-keyboard-micro-snapshot-source")]', result.context);
    assert.equal((await result.run()).bridgeSnapshot.source, "discovery");
  });
}

test("an expired Rspack source reads the committed tree after a remount", async () => {
  const result = await snapshotFixture("rspack");
  vm.runInContext('globalThis[Symbol.for("codex-keyboard-micro-snapshot-source")].discoveredAt = 0', result.context);
  const nextSlots = result.value.slots.map((slot) => ({ ...slot, status: "unread" }));
  const nextRoot = {
    memoizedProps: { value: new Map([[Symbol("new scope"), { store: { get: () => nextSlots } }]]) },
    child: result.rootFiber.child
  };
  result.rootFiber.stateNode.current = nextRoot;
  const snapshot = await result.run();
  assert.equal(snapshot.slots[0].status, "unread");
  assert.equal(snapshot.bridgeSnapshot.source, "discovery");
  assert.ok(snapshot.usage);
});

test("Rspack action discovery dispatches a key once and never retries a timeout", async () => {
  const result = await snapshotFixture("rspack");
  vm.runInContext('delete globalThis[Symbol.for("codex-keyboard-micro-bus")]', result.context);
  vm.runInContext('delete globalThis[Symbol.for("codex-keyboard-rspack-modules")]', result.context);
  const client = new CodexCdpClient();
  client.evaluate = (expression) => vm.runInContext(
    expression.replaceAll("(url) => import(url)", "importNamespace"), result.context
  );
  await client.dispatchAction("ACT06", 1);
  assert.equal(result.value.messages.length, 1);
  assert.equal(result.value.messages[0].event.key, "ACT06");
  assert.equal(result.value.messages[0].event.act, 1);
  let attempts = 0;
  client.evaluate = async () => {
    attempts += 1;
    throw new Error("Codex runtime response timed out");
  };
  await assert.rejects(client.dispatchAction("ACT06", 0), /timed out/);
  assert.equal(attempts, 1);
});
