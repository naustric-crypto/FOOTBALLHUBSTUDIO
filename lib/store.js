// lib/store.js
//
// Persistent-ish storage for the Analyst Studio: discovered videos, match
// identifications, analyses, generated content, analytics events and the
// content pipeline.
//
// IMPORTANT design constraints:
//  * The existing FootballHub site must not depend on this file. It is
//    additive only.
//  * On Vercel, serverless instances are ephemeral. We therefore default
//    to a globalThis Map (warm-instance reuse, same tradeoff as
//    lib/cache.js) and transparently upgrade to Upstash Redis REST when
//    UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set.
//  * Nothing here throws on load. If the backing store is unavailable we
//    degrade to memory rather than breaking a request.

const crypto = require("crypto");
const { database } = require("./config");

const mem =
  globalThis.__footballHubStudioStore ||
  (globalThis.__footballHubStudioStore = {
    videos: new Map(),        // youtube_video_id -> video record
    searches: new Map(),      // search signature -> { at, ids }
    matches: new Map(),       // match id -> match record
    analyses: new Map(),      // analysis id -> analysis record
    content: new Map(),       // content id -> social content record
    pipeline: new Map(),      // entity id -> pipeline record
    events: [],               // analytics events (capped)
    errors: [],               // API errors (capped)
    channels: new Map(),      // channel_id -> known channel { uploadsPlaylistId, lastPolled }
  });

const MAX_EVENTS = 5000;
const MAX_ERRORS = 200;

function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

// -------- optional Redis REST (Upstash-compatible) --------

function redisEnabled() {
  return Boolean(database.redisRestUrl && database.redisRestToken);
}

async function redis(command, ...args) {
  if (!redisEnabled()) return null;
  try {
    const path = [command, ...args].map(encodeURIComponent).join("/");
    const res = await fetch(`${database.redisRestUrl}/${path}`, {
      headers: { Authorization: `Bearer ${database.redisRestToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result;
  } catch {
    return null;
  }
}

async function redisGet(key) {
  const raw = await redis("get", key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisSet(key, value) {
  await redis("set", key, JSON.stringify(value));
}

// -------- shared-store hydration ------------------------------------------
// Writes are mirrored to Redis, but reads are synchronous from local
// memory. Each deployment (studio on Netlify, official website on Vercel)
// starts with EMPTY memory, so without this a published analysis would
// 404 on the other side. whenReady() pulls the shared records down once
// per process; it is awaited by the Netlify adapter and by the public
// article/analytics/analysis handlers before they serve data.
let hydration = null;

async function hydrateMap(map, prefix, cap = 2000) {
  const keys = await redis("keys", prefix + "*");
  if (!Array.isArray(keys) || !keys.length) return;
  const sorted = keys.sort().slice(-cap);
  for (let i = 0; i < sorted.length; i += 50) {
    const chunk = sorted.slice(i, i + 50);
    const vals = await redis("mget", ...chunk);
    if (!Array.isArray(vals)) return;
    chunk.forEach((k, idx) => {
      const raw = vals[idx];
      if (!raw) return;
      let v;
      try {
        v = JSON.parse(raw);
      } catch {
        return;
      }
      if (!v || typeof v !== "object") return;
      const idKey = decodeURIComponent(k.slice(prefix.length));
      if (!map.has(idKey)) map.set(idKey, v); // never clobber local writes
    });
  }
}

async function hydrateList(arr, prefix, cap) {
  const keys = await redis("keys", prefix + "*");
  if (!Array.isArray(keys) || !keys.length) return;
  const sorted = keys.sort().slice(-cap);
  const loaded = [];
  for (let i = 0; i < sorted.length; i += 50) {
    const chunk = sorted.slice(i, i + 50);
    const vals = await redis("mget", ...chunk);
    if (!Array.isArray(vals)) return;
    vals.forEach((raw) => {
      if (!raw) return;
      try {
        loaded.push(JSON.parse(raw));
      } catch {
        /* skip malformed */
      }
    });
  }
  if (!loaded.length) return;
  if (!arr.length) {
    arr.push(...loaded);
    return;
  }
  const seen = new Set(
    arr.map((x) => `${x.at}|${x.scope || ""}|${x.source || ""}|${x.content || ""}`)
  );
  for (const item of loaded) {
    const sig = `${item.at}|${item.scope || ""}|${item.source || ""}|${item.content || ""}`;
    if (!seen.has(sig)) arr.push(item);
  }
  arr.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function whenReady() {
  if (!redisEnabled()) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      await hydrateMap(mem.videos, "fh:video:");
      await hydrateMap(mem.matches, "fh:match:");
      await hydrateMap(mem.analyses, "fh:analysis:");
      await hydrateMap(mem.content, "fh:content:");
      await hydrateMap(mem.pipeline, "fh:pipeline:");
      await hydrateMap(mem.channels, "fh:channel:");
      await hydrateMap(mem.searches, "fh:search:");
      await hydrateList(mem.events, "fh:event:", MAX_EVENTS);
      await hydrateList(mem.errors, "fh:error:", MAX_ERRORS);
    } catch {
      // Degrade to whatever is already in memory — never break a request.
    }
  })();
  return hydration;
}

// -------- API error log (surfaced on the dashboard) --------

function recordError(scope, message) {
  const rec = { scope, message: String(message), at: nowIso() };
  mem.errors.push(rec);
  if (mem.errors.length > MAX_ERRORS) mem.errors.shift();
  // Mirror (fire-and-forget) so the studio dashboard sees the official
  // website's API errors too.
  if (redisEnabled()) {
    redisSet(`fh:error:${rec.at}-${crypto.randomBytes(4).toString("hex")}`, rec);
  }
}

function recentErrors(limit = 20) {
  return mem.errors.slice(-limit).reverse();
}

// -------- YouTube videos --------

// Deduplicate by YouTube video ID: same video discovered twice updates the
// existing record instead of creating a duplicate.
async function upsertVideo(video) {
  const existing = mem.videos.get(video.youtube_video_id);
  const merged = {
    ...existing,
    ...video,
    first_seen_at: existing?.first_seen_at || nowIso(),
    last_seen_at: nowIso(),
  };
  mem.videos.set(video.youtube_video_id, merged);
  if (redisEnabled()) await redisSet(`fh:video:${video.youtube_video_id}`, merged);
  return merged;
}

function getVideo(videoId) {
  return mem.videos.get(videoId) || null;
}

function listVideos(limit = 50, filter = {}) {
  let list = Array.from(mem.videos.values());
  if (filter.category) list = list.filter((v) => v.category === filter.category);
  if (filter.query) {
    const q = filter.query.toLowerCase();
    list = list.filter(
      (v) =>
        (v.title || "").toLowerCase().includes(q) ||
        (v.channel_title || "").toLowerCase().includes(q)
    );
  }
  return list
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, limit);
}

// -------- Search result cache (avoid re-issuing expensive broad searches) --------

function searchKey(params) {
  const normalized = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return normalized;
}

function getSearchCache(key) {
  return mem.searches.get(key) || null;
}

function setSearchCache(key, videoIds, ttlMs) {
  const record = { at: Date.now(), expiresAt: Date.now() + ttlMs, videoIds };
  mem.searches.set(key, record);
  // Mirror so every instance reuses the same expensive search results.
  if (redisEnabled()) redisSet(`fh:search:${encodeURIComponent(key)}`, record);
}

// -------- Known channels (for uploads-playlist polling) --------

async function rememberChannel(channelId, uploadsPlaylistId) {
  const rec = {
    channel_id: channelId,
    uploads_playlist_id: uploadsPlaylistId,
    last_polled_at: nowIso(),
  };
  mem.channels.set(channelId, rec);
  if (redisEnabled()) await redisSet(`fh:channel:${channelId}`, rec);
  return rec;
}

function getChannel(channelId) {
  return mem.channels.get(channelId) || null;
}

// -------- Matches --------

async function saveMatch(match) {
  const record = { id: match.id || id("match"), updated_at: nowIso(), ...match };
  mem.matches.set(record.id, record);
  if (redisEnabled()) await redisSet(`fh:match:${record.id}`, record);
  return record;
}

function getMatch(matchId) {
  return mem.matches.get(matchId) || null;
}

function listMatches(limit = 20) {
  return Array.from(mem.matches.values())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit);
}

// -------- Analyses --------

async function saveAnalysis(analysis) {
  const record = { id: analysis.id || id("analysis"), updated_at: nowIso(), ...analysis };
  mem.analyses.set(record.id, record);
  if (redisEnabled()) await redisSet(`fh:analysis:${record.id}`, record);
  return record;
}

function getAnalysis(analysisId) {
  return mem.analyses.get(analysisId) || null;
}

function listAnalyses(limit = 20) {
  return Array.from(mem.analyses.values())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit);
}

// -------- Social content --------

async function saveContent(content) {
  const record = { id: content.id || id("content"), updated_at: nowIso(), ...content };
  mem.content.set(record.id, record);
  if (redisEnabled()) await redisSet(`fh:content:${record.id}`, record);
  return record;
}

function getContent(contentId) {
  return mem.content.get(contentId) || null;
}

function listContent(limit = 20) {
  return Array.from(mem.content.values())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit);
}

// -------- Pipeline --------

async function setPipelineStage(entityId, stage, meta = {}) {
  const prev = mem.pipeline.get(entityId) || { entity_id: entityId, history: [] };
  const record = {
    ...prev,
    entity_id: entityId,
    stage,
    meta: { ...prev.meta, ...meta },
    updated_at: nowIso(),
    history: [...prev.history, { stage, at: nowIso() }],
  };
  mem.pipeline.set(entityId, record);
  if (redisEnabled()) await redisSet(`fh:pipeline:${entityId}`, record);
  return record;
}

function getPipeline(entityId) {
  return mem.pipeline.get(entityId) || null;
}

function listPipeline(limit = 50) {
  return Array.from(mem.pipeline.values())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit);
}

function listPipelineByStage(stage) {
  return listPipeline(500).filter((p) => p.stage === stage);
}

// -------- Analytics --------

function trackEvent(event) {
  const record = {
    landing_page_view: Boolean(event.landing_page_view),
    source: event.source || "unknown",
    medium: event.medium || "unknown",
    campaign: event.campaign || "",
    content: event.content || "",
    match_id: event.match_id || "",
    path: event.path || "",
    at: nowIso(),
  };
  mem.events.push(record);
  if (mem.events.length > MAX_EVENTS) mem.events.shift();
  // Mirror (fire-and-forget): landing views are recorded on the OFFICIAL
  // website, but the studio dashboard reports the funnel.
  if (redisEnabled()) {
    redisSet(`fh:event:${record.at}-${crypto.randomBytes(4).toString("hex")}`, record);
  }
  return record;
}

function analyticsSummary() {
  const bySource = {};
  for (const e of mem.events) {
    const key = `${e.source}/${e.medium}`;
    bySource[key] = (bySource[key] || 0) + 1;
  }
  return {
    total: mem.events.length,
    by_source: bySource,
    recent: mem.events.slice(-25).reverse(),
  };
}

module.exports = {
  id,
  nowIso,
  whenReady,
  upsertVideo,
  getVideo,
  listVideos,
  searchKey,
  getSearchCache,
  setSearchCache,
  rememberChannel,
  getChannel,
  saveMatch,
  getMatch,
  listMatches,
  saveAnalysis,
  getAnalysis,
  listAnalyses,
  saveContent,
  getContent,
  listContent,
  setPipelineStage,
  getPipeline,
  listPipeline,
  listPipelineByStage,
  trackEvent,
  analyticsSummary,
  recordError,
  recentErrors,
};