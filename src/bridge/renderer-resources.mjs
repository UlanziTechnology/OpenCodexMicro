export function collectRendererScriptUrls(frameTree) {
  const urls = new Set();
  const visit = (tree) => {
    for (const resource of tree?.resources ?? []) {
      if (resource.type !== "Script") continue;
      try {
        const url = new URL(resource.url);
        if (url.protocol === "app:" && url.pathname.startsWith("/assets/") &&
            url.pathname.endsWith(".js")) {
          urls.add(url.href);
        }
      } catch {}
    }
    for (const child of tree?.childFrames ?? []) visit(child);
  };
  visit(frameTree);
  return [...urls];
}

export function rendererResourceUrls() {
  return [...new Set([
    ...(globalThis[Symbol.for("codex-keyboard-renderer-resource-urls")] ?? []),
    ...[...document.querySelectorAll("link[href],script[src]")]
      .map((element) => element.href || element.src),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ])].filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "app:" && url.pathname.startsWith("/assets/") &&
        url.pathname.endsWith(".js");
    } catch {
      return false;
    }
  });
}

export async function collectRendererCoreUrls({ urls, readSource }) {
  const result = new Set(urls);
  const visited = new Set();
  const isCore = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "app:" &&
        /^\/assets\/(?:index(?:\.client)?|app-(?:main|runtime|initial|shared|primary)|vscode-api|codex-micro-(?:bridge|slot-signals))-[^/]+\.js$/.test(url.pathname);
    } catch { return false; }
  };
  // Static imports can be absent from both CDP resources and Resource Timing.
  for (let depth = 0; depth < 6 && visited.size < 12; depth += 1) {
    const batch = [...result].filter((url) => isCore(url) && !visited.has(url))
      .slice(0, 12 - visited.size);
    if (!batch.length) break;
    for (const url of batch) visited.add(url);
    const sources = await Promise.allSettled(batch.map((url) => readSource(url)));
    for (const [index, source] of sources.entries()) {
      if (source.status !== "fulfilled" || typeof source.value !== "string") continue;
      const imports = source.value.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*)["'`](\.\/(?:app-(?:main|runtime|initial|shared|primary)|vscode-api|codex-micro-(?:bridge|slot-signals))-[^/"'`?#]+\.js)["'`]/g
      );
      for (const match of imports) {
        const dependency = new URL(match[1], batch[index]);
        if (isCore(dependency.href)) result.add(dependency.href);
      }
    }
  }
  return [...result];
}

export async function resolveMicroBus({ cachedBus, urls, importNamespace }) {
  const isBus = (candidate) => Boolean(
    candidate && typeof candidate === "object" &&
    candidate.handlers instanceof Map &&
    (typeof candidate.dispatchHostMessage === "function" ||
      typeof candidate.dispatchMessage === "function")
  );
  if (isBus(cachedBus)) return cachedBus;
  for (const url of [...new Set(urls)]
    .filter((candidate) => /vscode-api|codex-micro|app-initial|app-shared/.test(candidate))
    .slice(0, 120)) {
    try {
      const namespace = await importNamespace(url);
      const bus = Object.values(namespace).find(isBus);
      if (bus) return bus;
    } catch {}
  }
  return null;
}

export function readSignalValue(node, resolver, contextMap) {
  const resolved = resolver.resolve(node, contextMap);
  return node.store.get(resolved?.atom ?? resolved);
}
