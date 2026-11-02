import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { selectRateLimitQuery } from "../src/bridge/rate-limit-query.mjs";
import { CodexCdpClient } from "../src/bridge/codex-cdp.mjs";

function query(key, updatedAt = 100, observers = 0, data = {}) {
  return {
    queryKey: key,
    getObserversCount: () => observers,
    isActive: () => false,
    state: { data, dataUpdatedAt: updatedAt }
  };
}

test("rate-limit selection accepts legacy and identity-scoped keys", () => {
  const legacy = query(["rate-limit-status"]);
  const scoped = query(["rate-limit-status", "user-current", "account-current"], 200, 1, {
    user_id: "user-current",
    account_id: "account-current"
  });
  assert.equal(selectRateLimitQuery([legacy]), legacy);
  assert.equal(selectRateLimitQuery([legacy, scoped]), scoped);
});

test("rate-limit selection preserves the known account/rateLimits compatibility key", () => {
  const legacy = query(["rate-limit-status"], 10, 0, null);
  const account = query(["account", "rateLimits"], 200);
  assert.equal(selectRateLimitQuery([legacy, account]), account);
});

test("rate-limit selection excludes image-generation and unrelated queries", () => {
  const image = query(["rate-limit-status", "image-generation", "identity", null], 900, 1);
  const imageShort = query(["rate-limit-status", "image-generation", "identity"], 900, 1);
  const similar = query(["other-rate-limit-status"], 900, 1);
  const unrelated = query(["settings"], 900, 1);
  const main = query(["rate-limit-status", "user-current", "account-current"], 100, 1);
  assert.equal(selectRateLimitQuery([image, imageShort, similar, unrelated, main]), main);
  assert.equal(selectRateLimitQuery([image, imageShort, similar, unrelated]), null);
});

test("subscribed push queries outrank newer retained data from another account", () => {
  const retained = query(["rate-limit-status", "user-old", "account-old"], 900, 0);
  const current = query(["rate-limit-status", "user-current", "account-current"], 100, 1);
  assert.equal(current.isActive(), false);
  assert.equal(selectRateLimitQuery([retained, current]), current);
});

test("pending current identities do not fall back to old account or legacy data", () => {
  const retained = query(["rate-limit-status", "user-old", "account-old"], 900, 0);
  const legacy = query(["rate-limit-status"], 1000);
  const current = query(["rate-limit-status", "user-current", "account-current"], 0, 1, null);
  assert.equal(selectRateLimitQuery([legacy, retained, current]), current);
  assert.equal(selectRateLimitQuery([retained, current]).state.data, null);
});

test("ambiguous identities are unavailable instead of guessed from timestamps", () => {
  const left = query(["rate-limit-status", "user-a", "account-a"], 100, 1);
  const right = query(["rate-limit-status", "user-b", "account-b"], 900, 1);
  assert.equal(selectRateLimitQuery([left, right]), null);
  left.getObserversCount = right.getObserversCount = () => 0;
  assert.equal(selectRateLimitQuery([left, right]), null);
});

test("newest data is selected only within the same identity", () => {
  const key = ["rate-limit-status", "user-current", "account-current"];
  const older = query(key, 100, 1);
  const newer = query([...key], 200, 1);
  const input = [older, newer];
  assert.equal(selectRateLimitQuery(input), newer);
  assert.deepEqual(input, [older, newer]);
});

test("identity-scoped data must agree with the query user and account ids", () => {
  const key = ["rate-limit-status", "user-current", "account-current"];
  for (const data of [
    { user_id: "user-other", account_id: "account-current" },
    { user_id: "user-current", account_id: "account-other" },
    { userId: "user-other", accountId: "account-current" }
  ]) {
    assert.equal(selectRateLimitQuery([query(key, 200, 1, data)]), null);
  }
  const personal = query(key, 200, 1, { user_id: "user-current", account_id: "" });
  assert.equal(selectRateLimitQuery([personal]), personal);
});

test("observed legacy queries outrank unobserved scoped caches", () => {
  const retained = query(["rate-limit-status", "user-old", "account-old"], 900);
  const legacy = query(["rate-limit-status"], 100, 1);
  assert.equal(selectRateLimitQuery([retained, legacy]), legacy);
});

test("malformed keys are not treated as account-wide rate limits", () => {
  const malformed = [
    null,
    {},
    query("rate-limit-status"),
    query(["rate-limit-status", "", "account"]),
    query(["rate-limit-status", "user", null]),
    query(["rate-limit-status", "user", "account", "feature"])
  ];
  assert.equal(selectRateLimitQuery(malformed), null);
});

test("the selector remains self-contained when injected into the renderer", () => {
  const current = query(["rate-limit-status", "user-current", "account-current"], 200, 1);
  const selected = vm.runInNewContext(`(${selectRateLimitQuery.toString()})(queries)`, {
    queries: [current]
  });
  assert.equal(selected, current);
});

test("snapshot reads scoped usage across query clients and throttles refreshes", async () => {
  const client = new CodexCdpClient();
  client.connect = async () => {};
  const legacy = query(["rate-limit-status"], Date.now(), 0, {
    rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 604800 } }
  });
  const current = query(["rate-limit-status", "user-current", "account-current"], 100, 1, {
    user_id: "user-current",
    account_id: "account-current",
    rate_limit: { primary_window: { used_percent: 60, limit_window_seconds: 604800 } }
  });
  const image = query(["rate-limit-status", "image-generation", "identity", null], Date.now(), 1, {
    rate_limit: { primary_window: { used_percent: 99, limit_window_seconds: 604800 } }
  });
  let refreshes = 0;
  current.fetch = () => { refreshes += 1; return Promise.resolve(); };
  legacy.fetch = image.fetch = () => assert.fail("Unrelated queries must not refresh");
  const root = { __reactContainer$test: {} };
  const slots = Array.from({ length: 6 }, (_, id) => ({ id }));
  const context = vm.createContext({
    performance,
    setTimeout,
    document: { getElementById: () => root, querySelector: () => null },
    [Symbol.for("codex-keyboard-micro-snapshot-source")]: {
      root,
      node: { store: { get: () => slots } },
      resolver: { resolve: () => ({}) },
      discoveredAt: Date.now(),
      apiClient: { safeGet: () => assert.fail("Token API is not involved in rate-limit reads") },
      queryClients: [
        { getQueryCache: () => ({ getAll: () => [legacy] }) },
        { getQueryCache: () => ({ getAll: () => [image, current] }) }
      ]
    },
    [Symbol.for("codex-keyboard-token-quota-cache-v2")]: {
      data: { dailyTokens: 123 },
      updatedAt: Date.now()
    }
  });
  client.evaluate = (expression) => vm.runInContext(expression, context);
  const snapshot = await client.snapshot();
  assert.equal(snapshot.slots.length, 6);
  assert.equal(snapshot.usage.windows[0].remainingPercent, 40);
  assert.equal(snapshot.usage.observedAt, 100);
  await client.snapshot();
  assert.equal(refreshes, 1);
  current.state.data.rate_limit.primary_window.used_percent = 61;
  current.state.dataUpdatedAt = Date.now();
  assert.equal((await client.snapshot()).usage.windows[0].remainingPercent, 39);
  assert.equal(refreshes, 1);
  current.state.data = null;
  assert.equal((await client.snapshot()).usage, null);
});
