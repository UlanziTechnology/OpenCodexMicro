export function selectRateLimitQuery(queries) {
  const candidates = [];
  for (const query of queries ?? []) {
    const key = query?.queryKey;
    if (!Array.isArray(key)) continue;
    const legacy = key.length === 1 && key[0] === "rate-limit-status";
    const account = key.length === 2 && key[0] === "account" && key[1] === "rateLimits";
    const scoped = key.length === 3 && key[0] === "rate-limit-status" &&
      key[1] !== "image-generation" &&
      key.slice(1).every((value) => typeof value === "string" && value.trim());
    if (!legacy && !account && !scoped) continue;
    let observed = false;
    try {
      observed = typeof query.getObserversCount === "function"
        ? query.getObserversCount() > 0
        : (query.observers?.length ?? 0) > 0;
    } catch {}
    candidates.push({
      query,
      identity: scoped ? JSON.stringify(key.slice(1)) : null,
      observed
    });
  }

  // Push-backed queries can be disabled but still subscribed. Observer presence,
  // not isActive(), distinguishes the current identity from retained caches.
  const observedScoped = candidates.filter((candidate) =>
    candidate.observed && candidate.identity !== null
  );
  const observed = candidates.filter((candidate) => candidate.observed);
  const scoped = candidates.filter((candidate) => candidate.identity !== null);
  const pool = observedScoped.length ? observedScoped
    : observed.length ? observed
      : scoped.length ? scoped
        : candidates;
  const identities = new Set(pool.map((candidate) => candidate.identity));
  if (identities.size > 1) return null;

  const selected = [...pool].sort((left, right) =>
    (Number(right.query.state?.dataUpdatedAt) || 0) -
    (Number(left.query.state?.dataUpdatedAt) || 0)
  )[0];
  if (!selected) return null;
  if (selected.identity !== null) {
    const data = selected.query.state?.data;
    const userId = data?.user_id ?? data?.userId;
    const accountId = data?.account_id ?? data?.accountId;
    const [, keyUserId, keyAccountId] = selected.query.queryKey;
    if (userId != null && userId !== keyUserId) return null;
    // Personal-account responses may omit account_id or return an empty string.
    if (accountId != null && accountId !== "" && accountId !== keyAccountId) return null;
  }
  return selected.query;
}
