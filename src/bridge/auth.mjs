import { timingSafeEqual } from "node:crypto";

export function bridgeRequestAuthorized(token, authorizationHeader) {
  if (!token) return false;
  const candidate = String(authorizationHeader || "").replace(/^Bearer\s+/i, "");
  const actual = Buffer.from(token);
  const supplied = Buffer.from(candidate);
  return actual.length === supplied.length && timingSafeEqual(actual, supplied);
}
