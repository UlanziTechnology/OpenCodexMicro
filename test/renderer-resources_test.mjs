import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { CodexCdpClient } from "../src/bridge/codex-cdp.mjs";
import {
  collectRendererCoreUrls,
  collectRendererScriptUrls,
  readSignalValue,
  rendererResourceUrls,
  resolveMicroBus
} from "../src/bridge/renderer-resources.mjs";

test("cold resource discovery follows core static imports absent from CDP and timing", async () => {
  const shared = "app://-/assets/app-shared-a.js";
  const initial = "app://-/assets/app-initial-b.js";
  const primary = "app://-/assets/app-primary-c.js";
  const bridge = "app://-/assets/codex-micro-bridge-d.js";
  const slots = "app://-/assets/codex-micro-slot-signals-e.js";
  const calls = [];
  const sources = new Map([
    [shared, `import { value } from "./app-initial-b.js"; import x from "./unrelated.js";`],
    [initial, `import { value } from './app-primary-c.js'; import x from "https://example.com/app-initial-x.js";`],
    [primary, 'import { value } from "./app-shared-a.js"; const micro = () => import(`./codex-micro-bridge-d.js`);'],
    [bridge, `import { value } from "./codex-micro-slot-signals-e.js";`],
    [slots, ""]
  ]);
  assert.deepEqual(await collectRendererCoreUrls({
    urls: [shared, "app://-/assets/unrelated.js"],
    readSource: async (url) => { calls.push(url); return sources.get(url); }
  }), [shared, "app://-/assets/unrelated.js", initial, primary, bridge, slots]);
  assert.deepEqual(calls, [shared, initial, primary, bridge, slots]);
});

test("core discovery tolerates unavailable source and bounds dependency reads", async () => {
  const urls = Array.from({ length: 20 }, (_, index) => `app://-/assets/app-shared-${index}.js`);
  let reads = 0;
  const result = await collectRendererCoreUrls({
    urls,
    readSource: async () => { reads += 1; throw new Error("Not available"); }
  });
  assert.deepEqual(result, urls);
  assert.equal(reads, 12);
});

test("entry-only discovery reaches Micro signals through main and lazy bridge imports", async () => {
  const urls = ["index-a", "app-main-b", "app-initial-c", "app-runtime-d", "app-primary-e", "codex-micro-bridge-f", "codex-micro-slot-signals-g"]
    .map((name) => `app://-/assets/${name}.js`);
  const sources = new Map([
    [urls[0], "import('./app-main-b.js')"],
    [urls[1], `import x from "./app-initial-c.js"; import y from "./app-runtime-d.js";`],
    [urls[2], ""],
    [urls[3], `import x from "./app-primary-e.js";`],
    [urls[4], "import(`./codex-micro-bridge-f.js`)"],
    [urls[5], `import x from "./codex-micro-slot-signals-g.js";`],
    [urls[6], ""]
  ]);
  assert.deepEqual(await collectRendererCoreUrls({
    urls: [urls[0]], readSource: async (url) => sources.get(url)
  }), urls);
});

test("CDP resources retain loaded Micro scripts after Resource Timing is cleared", () => {
  const shared = "app://-/assets/app-shared-hash.js";
  const slots = "app://-/assets/codex-micro-slot-signals-hash.js";
  const urls = collectRendererScriptUrls({
    resources: [
      { type: "Script", url: shared },
      { type: "Script", url: slots },
      { type: "Stylesheet", url: "app://-/assets/theme.css" },
      { type: "Script", url: "https://example.com/assets/external.js" },
      { type: "Script", url: "app://-/other/unrelated.js" },
      { type: "Script", url: "invalid" }
    ],
    childFrames: [{ resources: [{ type: "Script", url: shared }] }]
  });
  const context = {
    URL,
    document: { querySelectorAll: () => [{ src: "app://-/assets/index-hash.js" }] },
    performance: { getEntriesByType: () => [] },
    [Symbol.for("codex-keyboard-renderer-resource-urls")]: urls
  };
  const found = vm.runInNewContext(`(${rendererResourceUrls.toString()})()`, context);
  assert.deepEqual([...found], [shared, slots, "app://-/assets/index-hash.js"]);
});

test("Micro bus discovery includes the shared bundle without importing unrelated scripts", async () => {
  const bus = { handlers: new Map(), dispatchHostMessage() {} };
  const calls = [];
  const found = await resolveMicroBus({
    cachedBus: null,
    urls: [
      "app://-/assets/unrelated.js",
      "app://-/assets/app-shared-hash.js",
      "app://-/assets/app-shared-hash.js"
    ],
    importNamespace: async (url) => { calls.push(url); return { bus }; }
  });
  assert.equal(found, bus);
  assert.deepEqual(calls, ["app://-/assets/app-shared-hash.js"]);
  assert.equal(await resolveMicroBus({
    cachedBus: bus,
    urls: [],
    importNamespace: () => assert.fail("Cached bus must be reused")
  }), bus);
});

test("signal reads support both direct atoms and wrapped atom resolutions", () => {
  const slots = Array.from({ length: 6 }, (_, id) => ({ id }));
  const atom = { read() { return slots; } };
  const node = { store: { get(value) {
    assert.equal(value, atom);
    return value.read();
  } } };
  assert.equal(readSignalValue(node, { resolve: () => atom }, new Map()), slots);
  assert.equal(readSignalValue(node, { resolve: () => ({ atom }) }, new Map()), slots);
});

test("CDP commands retain resource trees while Runtime.evaluate unwraps values", async () => {
  const client = new CodexCdpClient();
  const frames = { frame: { id: "main" }, resources: [] };
  client.socket = {
    readyState: 1,
    send(raw) {
      const { id, method } = JSON.parse(raw);
      client.handleMessage(JSON.stringify({
        id,
        result: method === "Runtime.evaluate"
          ? { result: { type: "boolean", value: false } }
          : { frameTree: frames }
      }));
    }
  };
  assert.deepEqual(await client.sendCommand("Page.getResourceTree", {}), { frameTree: frames });
  assert.equal(await client.evaluate("false"), false);
});

test("missing module discovery refreshes CDP resources and retries only the snapshot", async () => {
  const client = new CodexCdpClient();
  const snapshot = { slots: [] };
  let reads = 0;
  let refreshes = 0;
  client.connect = async () => {};
  client.refreshRendererResources = async () => { refreshes += 1; };
  client.evaluate = async () => {
    if (++reads === 1) throw new Error("Codex Micro slot signals are not loaded");
    return snapshot;
  };
  assert.equal(await client.snapshot(), snapshot);
  assert.equal(refreshes, 1);
  assert.equal(reads, 2);
  client.evaluate = async () => { throw new Error("Codex runtime response timed out"); };
  client.disconnect = () => {};
  await assert.rejects(client.snapshot(), /timed out/);
  assert.equal(refreshes, 1);
});
