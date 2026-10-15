import "./helpers/env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import vm from "node:vm";
import { localHeaders, allowedRequest, secureHandler, readJson, json, localClient } from "../src/shared/local-api.mjs";
import { encoderTicks, stateDigest } from "../src/shared/plugin-runtime.mjs";

test("local APIs require credentials, loopback authority and no browser origin", () => {
  const headers = { host: "127.0.0.1:1234", authorization: localHeaders("fixture").Authorization };
  const request = { method: "GET", url: "/state", headers };
  assert.equal(allowedRequest(request, "fixture", 1234), true);
  for (const patch of [{ origin: "https://evil.invalid" }, { origin: "null" }, { host: "evil.invalid:1234" }, { authorization: "" }, { "sec-fetch-site": "cross-site" }]) {
    for (const url of ["/state", "/action/approve", "/events", "/ws", "/auth/start"]) assert.equal(allowedRequest({ ...request, url, headers: { ...headers, ...patch } }, "fixture", 1234), false);
  }
  assert.equal(allowedRequest({ method: "GET", url: "/callback?code=x&state=y", headers: { host: headers.host } }, "fixture", 1234, { oauthCallback: true }), true);
  assert.equal(allowedRequest({ ...request, method: "POST", url: "/callback", headers: { host: headers.host } }, "fixture", 1234, { oauthCallback: true }), false);
});
test("HTTP gate blocks side effects and passes legitimate authenticated client", async t => {
  let handler, writes = 0;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  handler = secureHandler("fixture", port, async (req, res) => { const body = await readJson(req); writes++; json(res, 200, { ok: true, body }); });
  const url = `http://127.0.0.1:${port}`;
  const denied = await fetch(url, { method: "POST", headers: { Origin: "null" }, body: '{}' });
  assert.equal(denied.status, 403); assert.equal(writes, 0);
  const result = await localClient("fixture", url)("/play", { method: "POST", body: '{"safe":true}' });
  assert.deepEqual(result.body, { safe: true }); assert.equal(writes, 1);
});
test("body parser rejects arrays, malformed and oversized requests", async () => {
  for (const body of ["[]", "null", "bad"]) await assert.rejects(readJson(Readable.from([body])), /JSON object/);
  await assert.rejects(readJson(Readable.from(['{"a":"' + 'a'.repeat(100) + '"}']), 20), /too large/);
});
test("encoder normalizes named and numeric variants", () => {
  assert.deepEqual(["left", "right", "hold-left", "hold-right"].map(rotateEvent => encoderTicks({ rotateEvent })), [-1, 1, -1, 1]);
  assert.equal(encoderTicks({ param: { ticks: -2 } }), -2);
  for (const message of [{}, { rotate: "NaN" }, { param: { rotate: 0 } }]) assert.equal(encoderTicks(message), 0);
});
test("state digest includes visible identity, metrics and both quotas", () => {
  const state = { connected: true, slots: [{ threadKey: "a", title: "A", status: "idle" }], usage: { windows: [{ remainingPercent: 10 }, { remainingPercent: 20 }], observedAt: 1 }, updatedAt: 1 };
  assert.equal(stateDigest(state), stateDigest({ ...state, updatedAt: 2, usage: { ...state.usage, observedAt: 2 } }));
  for (const patch of [{ slots: [{ ...state.slots[0], threadKey: "b" }] }, { tokenUsage: { totalTokens: 3 } }, { usage: { windows: [{ remainingPercent: 10 }, { remainingPercent: 21 }] } }]) assert.notEqual(stateDigest(state), stateDigest({ ...state, ...patch }));
});
for (const plugin of ["codexmicro", "antigravity", "spotify", "codexcli"]) {
  test(`${plugin}: disconnected images remain eligible for replay`, async () => {
    const source = await fs.readFile(`integration/com.ulanzi.${plugin}.ulanziPlugin/plugin/app.js`, "utf8");
    const start = source.indexOf("function sendSvgState(");
    const fn = source.slice(start, source.indexOf("\n}", start) + 2);
    const sent = [];
    const context = vm.createContext({ socket: { readyState: 3 }, WebSocket: { OPEN: 1 }, send: message => sent.push(message), instance: { active: true } });
    vm.runInContext(fn, context); vm.runInContext('sendSvgState(instance,"image")', context);
    assert.equal(context.instance.lastDisplay, undefined);
    context.socket.readyState = 1; vm.runInContext('sendSvgState(instance,"image")', context);
    assert.equal(sent.length, 1); vm.runInContext('sendSvgState(instance,"image")', context); assert.equal(sent.length, 1);
    // Studio applies updates in order. A later manifest-state update would
    // replace the live image with the static placeholder (e.g. "79%").
    const displayed = sent[0].param.statelist.at(-1);
    assert.equal(displayed.type, 1, 'the live image must remain the final display');
    assert.equal(displayed.data, 'image');
    assert.equal(displayed.showtext, false);
    assert.equal(displayed.textData, '');
  });
}
test("inspector relay rejects arbitrary routes and returns structured failures", async () => {
  const source = await fs.readFile("integration/com.ulanzi.spotify.ulanziPlugin/plugin/app.js", "utf8");
  const start = source.indexOf("async function handleInspector(");
  const fn = source.slice(start, source.indexOf("\n}", start) + 2);
  const calls = [], replies = [];
  const context = vm.createContext({ URL, AbortSignal, send() {}, requestLocal: async (...args) => { calls.push(args); return { ok: true }; }, inspectorReply: (_send, _message, response) => replies.push(response) });
  vm.runInContext(fn, context);
  await context.handleInspector({ payload: { path: "/play", method: "POST", requestId: 1 } });
  assert.match(replies[0].error, /Unsupported/); assert.equal(calls.length, 0);
  await context.handleInspector({ payload: { path: "/status", method: "GET", requestId: 2 } });
  assert.equal(calls.length, 1); assert.equal(replies[1].data.ok, true);
});
