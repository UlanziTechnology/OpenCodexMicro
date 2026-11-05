export async function resolveRspackModules({ urls, importNamespace, cache = {} }) {
  const isRuntime = (value) => typeof value === "function" &&
    value.c && typeof value.c === "object" &&
    value.m && typeof value.m === "object";
  let runtime = cache.runtime;
  if (!isRuntime(runtime)) {
    for (const url of [...new Set(urls)].filter((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "app:" && !parsed.search && !parsed.hash &&
          /^\/assets\/[^/]+\.js$/.test(parsed.pathname);
      } catch { return false; }
    }).slice(0, 12)) {
      try {
        const candidate = (await importNamespace(url)).__webpack_require__;
        if (isRuntime(candidate)) {
          runtime = cache.runtime = candidate;
          break;
        }
      } catch {}
    }
  }
  const empty = { resolvers: [], bus: null };
  if (!isRuntime(runtime)) return empty;

  const ids = Object.keys(runtime.c);
  if (cache.bindings && cache.modules === runtime.c &&
      cache.moduleCount === ids.length) return cache.bindings;
  const resolvers = new Set();
  const buses = new Set();
  let sourceBytes = 0;
  let inspected = 0;
  // Read initialized exports only. Calling require(id) could start unrelated
  // application code or repeat its side effects.
  for (const id of ids.slice(0, 20000)) {
    const module = runtime.c[id];
    const factory = runtime.m[id];
    if (!module || module.error || typeof factory !== "function") continue;
    const source = Function.prototype.toString.call(factory);
    sourceBytes += source.length;
    if (sourceBytes > 64 * 1024 * 1024) break;
    const slots = source.includes("inactivityTimeoutMs") &&
      source.includes("voiceState") && source.includes("threadKeys") &&
      /(?:\bslots|["']slots["'])\s*:/.test(source);
    const bus = source.includes("handlers") &&
      /dispatchHostMessage|dispatchMessage/.test(source);
    if (!slots && !bus) continue;
    if (++inspected > 256) break;
    let exports = module.exports;
    // Rspack keeps async module exports behind its runtime-owned symbol.
    if (runtime.aE && exports?.[runtime.aE]) exports = exports[runtime.aE];
    if (!exports || !["object", "function"].includes(typeof exports)) continue;
    for (const key of Object.keys(exports).slice(0, 64)) {
      try {
        const value = exports[key];
        if (!value || typeof value !== "object") continue;
        if (slots && resolvers.size < 24 &&
            typeof value.resolve === "function" &&
            typeof value.createSubscriberAtom === "function") resolvers.add(value);
        if (bus && value.handlers instanceof Map &&
            (typeof value.dispatchHostMessage === "function" ||
              typeof value.dispatchMessage === "function")) buses.add(value);
      } catch {}
    }
  }
  const bindings = {
    resolvers: [...resolvers],
    bus: buses.size === 1 ? [...buses][0] : null
  };
  // Missing exports can appear later without changing the cache's size.
  if (bindings.resolvers.length && bindings.bus) {
    cache.bindings = bindings;
    cache.modules = runtime.c;
    cache.moduleCount = ids.length;
  } else {
    delete cache.bindings;
    delete cache.modules;
    delete cache.moduleCount;
  }
  return bindings;
}
