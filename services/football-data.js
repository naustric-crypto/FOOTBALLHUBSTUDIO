// services/football-data.js
//
// The football-data (API-Football) adapter, demoted to an OPTIONAL
// SECONDARY source.
//
// Contract: every function resolves — it never throws into the caller.
// If the API is unconfigured, rate-limited, fails, or simply has no recent
// match, we return { ok: false, reason } and the pipeline continues with
// YouTube metadata + AI extraction + manual confirmation.
//
// This is the key behavioural change from the original FootballHub where
// a missing football-data key threw and failed the request.

const { getCached, setCached } = require("../lib/cache");
const store = require("../lib/store");
const { footballData } = require("../lib/config");

async function call(endpoint, params, ttlMs = footballData.ttl) {
  if (!footballData.enabled) {
    return { ok: false, reason: "FOOTBALL_API_KEY not configured" };
  }

  const qs = new URLSearchParams(params).toString();
  const cacheKey = `fdata:${endpoint}?${qs}`;
  const cached = getCached(cacheKey);
  if (cached) return { ok: true, data: cached, cached: true };

  try {
    const res = await fetch(`${footballData.baseUrl}${endpoint}?${qs}`, {
      headers: { "x-apisports-key": footballData.apiKey },
    });
    if (!res.ok) {
      const msg = `football-data ${endpoint} failed: ${res.status}`;
      store.recordError("football-data", msg);
      return { ok: false, reason: msg };
    }
    const json = await res.json();
    setCached(cacheKey, json, ttlMs);
    return { ok: true, data: json };
  } catch (err) {
    // Swallow: football-data must never break the newsroom.
    store.recordError("football-data", err.message);
    return { ok: false, reason: err.message };
  }
}

// Look up fixtures for a given date (YYYY-MM-DD). Used to corroborate a
// match identified from YouTube metadata.
async function fixturesByDate(date) {
  const res = await call("/fixtures", { date }, footballData.ttl);
  if (!res.ok) return res;
  const response = res.data?.response || [];
  return { ok: true, fixtures: response, cached: res.cached };
}

// Head-to-head / recent fixtures between two teams, used as a soft
// confirmation signal. teamIds are API-Football ids when known.
async function fixturesByTeams(teamId, { season, last } = {}) {
  const params = { team: teamId };
  if (season) params.season = season;
  if (last) params.last = last;
  const res = await call("/fixtures", params, footballData.ttl);
  if (!res.ok) return res;
  return { ok: true, fixtures: res.data?.response || [], cached: res.cached };
}

// Team search -> id resolution (only used to enrich, never required).
async function searchTeam(name) {
  const res = await call("/teams", { search: name }, footballData.ttl);
  if (!res.ok) return res;
  return { ok: true, teams: res.data?.response || [] };
}

// Try to find a structured match matching an approximate date + team names.
// Returns { ok, match } where match carries the structured facts we can
// trust as FACTS (as opposed to YouTube-derived inferences).
async function findMatch({ homeTeam, awayTeam, date }) {
  if (!date) return { ok: false, reason: "no date to look up" };
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return { ok: false, reason: "invalid date" };

  // Look at the day before/after too — highlight videos often publish
  // slightly after kickoff and timezones shift the calendar day.
  const days = [-1, 0, 1].map((offset) => {
    const d = new Date(day);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  });

  for (const d of days) {
    const res = await fixturesByDate(d);
    if (!res.ok) return res;
    const found = (res.fixtures || []).find((f) => {
      const h = f.teams?.home?.name || "";
      const a = f.teams?.away?.name || "";
      const matchHome = homeTeam ? fuzzy(h, homeTeam) : true;
      const matchAway = awayTeam ? fuzzy(a, awayTeam) : true;
      return matchHome && matchAway;
    });
    if (found) {
      return {
        ok: true,
        match: {
          football_data_fixture_id: found.fixture?.id || null,
          competition: found.league?.name || null,
          home_team: found.teams?.home?.name || null,
          away_team: found.teams?.away?.name || null,
          score: `${found.goals?.home ?? "-"}-${found.goals?.away ?? "-"}`,
          match_date: (found.fixture?.date || "").slice(0, 10),
          status: found.fixture?.status?.short || null,
          venue: found.fixture?.venue?.name || null,
        },
      };
    }
  }
  return { ok: false, reason: "no structured match found" };
}

// Loose team-name comparison: "Man City" ~ "Manchester City".
function fuzzy(a, b) {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na.includes(nb) || nb.includes(na)) return true;
  const token = (s) => s.split(/\s+/).filter((w) => w.length > 3);
  const ta = token(na);
  const tb = token(nb);
  return ta.some((w) => tb.includes(w));
}

module.exports = {
  call,
  fixturesByDate,
  fixturesByTeams,
  searchTeam,
  findMatch,
  fuzzy,
};