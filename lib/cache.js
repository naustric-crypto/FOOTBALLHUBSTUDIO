// lib/cache.js
//
// Best-effort cache only. On Vercel, each serverless function may run in
// a fresh or a reused ("warm") instance — there's no guarantee of the
// same instance handling the next request, and no guarantee of only one
// instance existing at a time under real traffic. Using globalThis means
// a warm instance reuses its cache across invocations (which helps), but
// unlike a persistent server (Render, Railway), this is NOT a reliable
// shared cache across all visitors. If you outgrow this, look at Vercel
// KV or Upstash Redis (both have free tiers) for a real shared cache.

const store = globalThis.__footballHubCache || (globalThis.__footballHubCache = new Map());

function getCached(key) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) store.delete(key);
  return null;
}

function setCached(key, data, ttlMs) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

module.exports = { getCached, setCached, MINUTE, HOUR };
