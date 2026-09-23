// services/youtube.js
//
// YouTube Data API adapter — the PRIMARY discovery source for fresh
// football matches, highlights and news.
//
// Cost control (the whole point of this module):
//   * Only request the fields we render (config.parts).
//   * Cache search + list responses (store search cache + lib/cache).
//   * Deduplicate by youtube_video_id via lib/store.upsertVideo.
//   * For a KNOWN channel, use its uploads playlist + playlistItems
//     instead of repeatedly issuing expensive search.list calls.
//   * Callers choose maxResults; capped by config.
//
// This module is intentionally independent of the football-data API: a
// football-data outage must never stop YouTube discovery.

const { getCached, setCached } = require("../lib/cache");
const store = require("../lib/store");
const { youtube, MEDIA_STATUS } = require("../lib/config");

const API = youtube.baseUrl;

function assertEnabled() {
  if (!youtube.enabled) {
    const err = new Error(
      "YOUTUBE_API_KEY is not set. Add it in Vercel: Project Settings > Environment Variables."
    );
    err.code = "YOUTUBE_DISABLED";
    throw err;
  }
}

function clampMax(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v <= 0) return youtube.defaults.maxResults;
  return Math.min(v, youtube.defaults.maxResultsCap);
}

// ISO-8601 duration (PT1H2M3S) -> seconds.
function parseDuration(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const [, d, h, mm, s] = m;
  const total =
    parseInt(d || 0, 10) * 86400 +
    parseInt(h || 0, 10) * 3600 +
    parseInt(mm || 0, 10) * 60 +
    parseInt(s || 0, 10);
  return total || null;
}

function bestThumbnail(thumbs) {
  if (!thumbs) return "";
  return (
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    ""
  );
}

// Normalise a YouTube API resource into the canonical stored shape.
// Every field the brief requires is present:
// youtube_video_id, title, description, channel_id, channel_title,
// published_at, thumbnail, duration, category, caption_available,
// view_count, like_count, youtube_url, embed_url.
function normalizeVideo(snippet = {}, contentDetails = {}, statistics = {}, extra = {}) {
  const videoId = extra.youtube_video_id || snippet.resourceId?.videoId || "";
  const durationSeconds = parseDuration(contentDetails.duration);
  return {
    youtube_video_id: videoId,
    title: snippet.title || "",
    description: snippet.description || "",
    channel_id: snippet.channelId || "",
    channel_title: snippet.channelTitle || "",
    published_at: snippet.publishedAt || "",
    thumbnail: bestThumbnail(snippet.thumbnails),
    duration: contentDetails.duration || null,
    duration_seconds: durationSeconds,
    category: extra.category || null, // our football content category (set by scoring)
    youtube_category_id: snippet.categoryId || null,
    caption_available: contentDetails.caption === "true",
    view_count: statistics.viewCount ? Number(statistics.viewCount) : null,
    like_count: statistics.likeCount ? Number(statistics.likeCount) : null,
    comment_count: statistics.commentCount ? Number(statistics.commentCount) : null,
    youtube_url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    embed_url: videoId ? `https://www.youtube.com/embed/${videoId}` : "",
    tags: snippet.tags || [],
    live_broadcast: snippet.liveBroadcastContent || "none",
    default_audio_language: snippet.defaultAudioLanguage || null,
    default_language: snippet.defaultLanguage || null,
    // Rights: third-party YouTube highlights default to EMBED_ONLY.
    media_status: extra.media_status || MEDIA_STATUS.EMBED_ONLY,
    source: extra.source || "youtube_search",
  };
}

// Raw YouTube API fetch with caching. Only ever called with explicit parts.
async function ytFetch(path, params, ttlMs, cacheNs) {
  assertEnabled();
  const qs = new URLSearchParams({ ...params, key: youtube.apiKey }).toString();
  const cacheKey = `${cacheNs}:${qs}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${API}/${path}?${qs}`);
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message || "";
    } catch {
      /* ignore */
    }
    const err = new Error(`YouTube ${path} failed: ${res.status} ${detail}`.trim());
    err.status = res.status;
    store.recordError("youtube", err.message);
    throw err;
  }
  const json = await res.json();
  setCached(cacheKey, json, ttlMs);
  return json;
}

// ---------------------------------------------------------------------------
// search.list — broad discovery. Supports the full parameter surface from
// the brief: keyword, date range (publishedAfter/Before), order=date,
// type=video, video category, language, region, max results, pagination.
// ---------------------------------------------------------------------------
async function search({
  query,
  publishedAfter,
  publishedBefore,
  eventType,
  videoCategoryId,
  relevanceLanguage,
  regionCode,
  maxResults,
  pageToken,
  order,
  channelId,
  type,
} = {}) {
  const params = {
    part: youtube.defaults.searchParts,
    type: type || youtube.defaults.type, // video (default)
    order: order || youtube.defaults.order, // date -> newest first
    maxResults: clampMax(maxResults),
    regionCode: regionCode || youtube.defaults.regionCode,
    relevanceLanguage: relevanceLanguage || youtube.defaults.relevanceLanguage,
  };
  if (query) params.q = query;
  if (publishedAfter) params.publishedAfter = publishedAfter;
  if (publishedBefore) params.publishedBefore = publishedBefore;
  if (eventType) params.eventType = eventType; // live|completed|upcoming
  if (videoCategoryId) params.videoCategoryId = videoCategoryId;
  if (pageToken) params.pageToken = pageToken;
  if (channelId) params.channelId = channelId;

  // De-dup identical searches within the TTL window using the search cache.
  const key = store.searchKey(params);
  const cached = store.getSearchCache(key);
  if (cached && cached.expiresAt > Date.now()) {
    const items = cached.videoIds
      .map((id) => store.getVideo(id))
      .filter(Boolean);
    return { items, _cached: true, key, nextPageToken: cached.nextPageToken || null };
  }

  const json = await ytFetch("search", params, youtube.cache.search, "ytsearch");

  // For non-video searches we do not hydrate (and do not store) — the
  // discovery pipeline is video-first, as required by the brief.
  const ids = (json.items || [])
    .map((it) => it.id?.videoId)
    .filter(Boolean);

  // Hydrate full metadata (duration/stats) for the freshly found ids.
  const items = ids.length ? await getVideos(ids) : [];

  store.setSearchCache(key, ids, youtube.cache.search);
  const cacheRec = store.getSearchCache(key);
  if (cacheRec) cacheRec.nextPageToken = json.nextPageToken || null;

  return { items, nextPageToken: json.nextPageToken || null, _cached: false, key };
}

// ---------------------------------------------------------------------------
// videos.list — hydrate full metadata (duration, stats, captions). This is
// what turns a search hit into a rich, storable video record.
// ---------------------------------------------------------------------------
async function getVideos(videoIds = []) {
  const ids = videoIds.filter(Boolean).slice(0, youtube.defaults.maxResultsCap);
  if (!ids.length) return [];
  const params = {
    part: youtube.defaults.videoParts, // snippet,contentDetails,statistics
    id: ids.join(","),
  };
  const json = await ytFetch("videos", params, youtube.cache.video, "ytvideo");
  const videos = (json.items || []).map((it) =>
    normalizeVideo(it.snippet || {}, it.contentDetails || {}, it.statistics || {}, {
      youtube_video_id: it.id,
      source: "youtube_search",
    })
  );
  for (const v of videos) await store.upsertVideo(v);
  return videos;
}

async function getVideo(videoId) {
  const local = store.getVideo(videoId);
  try {
    const [fresh] = await getVideos([videoId]);
    return fresh || local || null;
  } catch (err) {
    // YouTube outage should not hide cached metadata we already have.
    return local || null;
  }
}

// ---------------------------------------------------------------------------
// channels.list — resolve the uploads playlist for a known channel so we can
// poll cheaply instead of re-running search.list every time.
// ---------------------------------------------------------------------------
async function getChannelUploadsPlaylist(channelId) {
  const known = store.getChannel(channelId);
  if (known?.uploads_playlist_id) return known.uploads_playlist_id;

  const params = { part: "contentDetails", id: channelId };
  const json = await ytFetch("channels", params, youtube.cache.channel, "ytchannel");
  const item = (json.items || [])[0];
  const uploads = item?.contentDetails?.relatedPlaylists?.uploads || null;
  if (uploads) await store.rememberChannel(channelId, uploads);
  return uploads;
}

// ---------------------------------------------------------------------------
// playlistItems.list — efficient polling of a known channel's recent
// uploads. The brief explicitly requires this over repeated search.
// ---------------------------------------------------------------------------
async function listChannelUploads(channelId, { maxResults = 12, pageToken } = {}) {
  const uploadsPlaylistId = await getChannelUploadsPlaylist(channelId);
  if (!uploadsPlaylistId) return { items: [], nextPageToken: null };

  const params = {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: clampMax(maxResults),
  };
  if (pageToken) params.pageToken = pageToken;

  const json = await ytFetch("playlistItems", params, youtube.cache.uploads, "ytuploads");
  const ids = (json.items || [])
    .map((it) => it.contentDetails?.videoId || it.snippet?.resourceId?.videoId)
    .filter(Boolean);

  // playlistItems lacks stats/duration -> hydrate via videos.list, then store.
  const videos = await getVideos(ids);
  for (const v of videos) v.source = "youtube_uploads";
  return { items: videos, nextPageToken: json.nextPageToken || null };
}

module.exports = {
  assertEnabled,
  search,
  getVideos,
  getVideo,
  getChannelUploadsPlaylist,
  listChannelUploads,
  normalizeVideo,
  parseDuration,
};