// lib/apiFootball.js
const { getCached, setCached } = require("./cache");

const BASE = "https://v3.football.api-sports.io";

async function apiFootball(endpoint, params, ttlMs) {
  const qs = new URLSearchParams(params).toString();
  const cacheKey = `${endpoint}?${qs}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error(
      "API_FOOTBALL_KEY is not set. Add it in Vercel: Project Settings > Environment Variables."
    );
  }

  const res = await fetch(`${BASE}${endpoint}?${qs}`, {
    headers: { "x-apisports-key": key },
  });

  if (!res.ok) {
    throw new Error(`API-Football ${endpoint} failed: ${res.status}`);
  }

  const json = await res.json();
  setCached(cacheKey, json, ttlMs);
  return json;
}

module.exports = { apiFootball };
