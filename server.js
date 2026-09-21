// server.js
// Small Express backend that sits between your frontend and the free
// football APIs. It caches responses in memory so 100 requests/day
// (API-Football's free cap) can serve many visitors instead of one.
//
// Data sources:
//   - API-Football (api-football.com)  -> leagues, standings, fixtures, predictions, odds
//   - Scorebat free video feed         -> goal/highlight clips (no key needed)

const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

if (!API_FOOTBALL_KEY) {
  console.warn(
    "\n[warning] API_FOOTBALL_KEY is not set. Standings/fixtures/predictions " +
      "will fail until you add a free key from https://dashboard.api-football.com " +
      "to your .env file (see .env.example).\n"
  );
}

// ---------------------------------------------------------------------
// Tiny in-memory cache: { key: { data, expiresAt } }
// This is what makes 100 req/day survive real traffic. Every route below
// picks a TTL based on how often that data actually changes.
// ---------------------------------------------------------------------
const cache = new Map();

function getCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) cache.delete(key);
  return null;
}

function setCached(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function apiFootball(endpoint, params, ttlMs) {
  const qs = new URLSearchParams(params).toString();
  const cacheKey = `${endpoint}?${qs}`;
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, fromCache: true };

  const res = await fetch(`${API_FOOTBALL_BASE}${endpoint}?${qs}`, {
    headers: { "x-apisports-key": API_FOOTBALL_KEY },
  });

  if (!res.ok) {
    throw new Error(`API-Football ${endpoint} failed: ${res.status}`);
  }

  const json = await res.json();
  setCached(cacheKey, json, ttlMs);
  return { data: json, fromCache: false };
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

// Search/browse leagues (worldwide, since API-Football covers ~1,236 of them)
// Leagues change almost never, so cache for a full day.
app.get("/api/leagues", async (req, res) => {
  try {
    const search = req.query.search || "";
    const params = search ? { search } : { current: "true" };
    const { data, fromCache } = await apiFootball("/leagues", params, 24 * HOUR);
    res.json({ fromCache, response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Standings table for one league + season
app.get("/api/standings", async (req, res) => {
  const { league, season } = req.query;
  if (!league || !season) {
    return res.status(400).json({ error: "league and season are required" });
  }
  try {
    const { data, fromCache } = await apiFootball(
      "/standings",
      { league, season },
      HOUR
    );
    res.json({ fromCache, response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Upcoming fixtures for a league
app.get("/api/fixtures", async (req, res) => {
  const { league, season, next } = req.query;
  if (!league || !season) {
    return res.status(400).json({ error: "league and season are required" });
  }
  try {
    const { data, fromCache } = await apiFootball(
      "/fixtures",
      { league, season, next: next || "10" },
      30 * MINUTE
    );
    res.json({ fromCache, response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Match-winner prediction + odds for one fixture.
// This is API-Football's own /predictions endpoint (not something we compute),
// which matches "show predictions pulled from a free API".
app.get("/api/predictions", async (req, res) => {
  const { fixture } = req.query;
  if (!fixture) return res.status(400).json({ error: "fixture id is required" });
  try {
    const { data, fromCache } = await apiFootball(
      "/predictions",
      { fixture },
      6 * HOUR
    );
    res.json({ fromCache, response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Betting odds for one fixture (separate endpoint, separate quota-friendly cache)
app.get("/api/odds", async (req, res) => {
  const { fixture } = req.query;
  if (!fixture) return res.status(400).json({ error: "fixture id is required" });
  try {
    const { data, fromCache } = await apiFootball("/odds", { fixture }, 6 * HOUR);
    res.json({ fromCache, response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Highlights: Scorebat's free feed. No key required, so no rate-limit risk,
// but we still cache to avoid hammering their servers.
app.get("/api/highlights", async (req, res) => {
  try {
    const cached = getCached("highlights");
    if (cached) return res.json({ fromCache: true, response: cached });

    const r = await fetch("https://www.scorebat.com/video-api/v1/");
    if (!r.ok) throw new Error(`Scorebat feed failed: ${r.status}`);
    const json = await r.json();
    const list = Array.isArray(json) ? json : json.response || [];
    setCached("highlights", list, 30 * MINUTE);
    res.json({ fromCache: false, response: list });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Football hub running on http://localhost:${PORT}`);
});