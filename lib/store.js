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

// -------- API error log (surfaced on the dashboard) --------

function recordError(scope, message) {
  mem.errors.push({ scope, message: String(message), at: nowIso() });
  if (mem.errors.length > MAX_ERRORS) mem.errors.shift();
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
  mem.searches.set(key, { at: Date.now(), expiresAt: Date.now() + ttlMs, videoIds });
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