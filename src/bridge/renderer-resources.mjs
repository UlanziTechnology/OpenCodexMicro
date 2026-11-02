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
