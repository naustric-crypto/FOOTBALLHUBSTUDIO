// lib/config.js
//
// Central configuration for the YouTube-first Analyst Studio.
//
// Design rule: nothing in here may throw at import time because the
// existing FootballHub site (news / highlights / standings) must keep
// working even when the new environment variables are not set yet.
// Every consumer treats a missing value as "feature disabled", not
// "crash the whole function".

const { MINUTE, HOUR } = require("./cache");

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? fallback : v;
}

function intEnv(name, fallback) {
  const n = parseInt(env(name, ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

// The official public FootballHub website we always funnel traffic back to.
// (The Analyst Studio admin lives on Netlify; viewers go here.)
const FOOTBALLHUB_BASE_URL = env(
  "FOOTBALLHUB_BASE_URL",
  "https://footballhubstudio-git-main-flash-scarcity.vercel.app"
);

// YouTube is the PRIMARY discovery source. It is deliberately configured
// independently of the football-data API so a football-data outage can
// never block discovery.
const youtube = {
  apiKey: env("YOUTUBE_API_KEY"),
  clientId: env("YOUTUBE_CLIENT_ID"),
  clientSecret: env("YOUTUBE_CLIENT_SECRET"),
  redirectUri: env("YOUTUBE_REDIRECT_URI"),
  baseUrl: "https://www.googleapis.com/youtube/v3",
  enabled: Boolean(env("YOUTUBE_API_KEY")),
  // How long a cached YouTube response is trusted, per kind of call.
  cache: {
    search: intEnv("YOUTUBE_SEARCH_TTL_MINUTES", 10) * MINUTE,
    video: intEnv("YOUTUBE_VIDEO_TTL_MINUTES", 30) * MINUTE,
    channel: intEnv("YOUTUBE_CHANNEL_TTL_MINUTES", 60) * MINUTE,
    uploads: intEnv("YOUTUBE_UPLOADS_TTL_MINUTES", 20) * MINUTE,
  },
  // Polling intervals (all changeable from configuration / env).
  poll: {
    // "Latest Football" dashboard refresh cadence for broad keyword searches.
    latestSeconds: intEnv("YOUTUBE_POLL_LATEST_SECONDS", 300),
    // Known-channel uploads polling cadence (uploads playlist, cheap).
    channelSeconds: intEnv("YOUTUBE_POLL_CHANNEL_SECONDS", 900),
  },
  defaults: {
    // Only request the fields we actually render.
    searchParts: "snippet",
    videoParts: "snippet,contentDetails,statistics",
    maxResults: intEnv("YOUTUBE_DEFAULT_MAX_RESULTS", 12),
    maxResultsCap: 50,
    order: "date", // prioritise the newest videos
    type: "video",
    regionCode: env("YOUTUBE_DEFAULT_REGION", "GB"),
    relevanceLanguage: env("YOUTUBE_DEFAULT_LANGUAGE", "en"),
  },
};

// The football-data API is now an OPTIONAL SECONDARY source. Errors are
// swallowed by services/football-data.js.
const footballData = {
  apiKey: env("FOOTBALL_API_KEY", env("API_FOOTBALL_KEY")), // reuse legacy name
  baseUrl: env("FOOTBALL_API_BASE_URL", "https://v3.football.api-sports.io"),
  enabled: Boolean(env("FOOTBALL_API_KEY", env("API_FOOTBALL_KEY"))),
  ttl: 30 * MINUTE,
};

const ai = {
  apiKey: env("AI_API_KEY"),
  model: env("AI_MODEL", "gpt-4o-mini"),
  baseUrl: env("AI_API_BASE_URL", "https://api.openai.com/v1"),
  enabled: Boolean(env("AI_API_KEY")),
};

const storage = {
  endpoint: env("STORAGE_ENDPOINT"),
  bucket: env("STORAGE_BUCKET"),
  accessKey: env("STORAGE_ACCESS_KEY"),
  secretKey: env("STORAGE_SECRET_KEY"),
  enabled: Boolean(env("STORAGE_ENDPOINT") && env("STORAGE_BUCKET")),
};

const instagram = {
  appId: env("INSTAGRAM_APP_ID"),
  appSecret: env("INSTAGRAM_APP_SECRET"),
  redirectUri: env("INSTAGRAM_REDIRECT_URI"),
  // Optional long-lived token for actually publishing.
  accessToken: env("INSTAGRAM_ACCESS_TOKEN"),
  businessAccountId: env("INSTAGRAM_BUSINESS_ACCOUNT_ID"),
  enabled: Boolean(env("INSTAGRAM_APP_ID") && env("INSTAGRAM_APP_SECRET")),
};

const analytics = {
  enabled: true, // first-party tracking, always on
};

const database = {
  url: env("DATABASE_URL"),
  // Optional managed key/value store for cross-instance caching on Vercel.
  redisRestUrl: env("UPSTASH_REDIS_REST_URL"),
  redisRestToken: env("UPSTASH_REDIS_REST_TOKEN"),
  writeToken: env("STUDIO_WRITE_TOKEN"), // shared secret for admin mutations
};

// Quick-pick competitions and exemplar teams, per the product brief.
const COMPETITIONS = [
  { name: "Premier League", keywords: ["premier league"], region: "GB" },
  { name: "Champions League", keywords: ["champions league", "uefa champions league"], region: "GB" },
  { name: "La Liga", keywords: ["la liga", "laliga"], region: "ES" },
  { name: "Serie A", keywords: ["serie a"], region: "IT" },
  { name: "Bundesliga", keywords: ["bundesliga"], region: "DE" },
  { name: "Ligue 1", keywords: ["ligue 1"], region: "FR" },
];

const TEAMS = [
  "Arsenal", "Chelsea", "Liverpool", "Manchester City", "Manchester United",
  "Real Madrid", "Barcelona", "Bayern Munich",
];

// Quick-pick search chips shown on /admin/youtube.
const QUICK_SEARCHES = [
  "Premier League highlights",
  "Champions League highlights",
  "La Liga highlights",
  "Serie A highlights",
  "Bundesliga highlights",
  "Ligue 1 highlights",
  ...TEAMS,
];

// Media rights statuses for every video source.
const MEDIA_STATUS = {
  EMBED_ONLY: "EMBED_ONLY",
  OWNED: "OWNED",
  LICENSED: "LICENSED",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PUBLIC_DOMAIN: "PUBLIC_DOMAIN",
  UNKNOWN: "UNKNOWN",
};

// Rights that permit deeper (download / computer-vision) processing.
const PROCESSABLE_RIGHTS = new Set([
  MEDIA_STATUS.OWNED,
  MEDIA_STATUS.LICENSED,
  MEDIA_STATUS.PERMISSION_GRANTED,
  MEDIA_STATUS.PUBLIC_DOMAIN,
]);

// Pipeline states, in order. No automatic publication ever.
const PIPELINE = [
  "DISCOVERED",
  "MATCH IDENTIFIED",
  "ANALYSIS READY",
  "CONTENT GENERATED",
  "ADMIN REVIEW",
  "APPROVED",
  "PUBLISHED",
];

// Build a UTM-tagged FootballHub URL for a social source.
function utmUrl(slug, source, medium = "social", campaign = "match_analysis") {
  const base = FOOTBALLHUB_BASE_URL.replace(/\/+$/, "");
  const path = slug ? `/analysis/${encodeURIComponent(slug)}` : "/";
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    utm_content: slug || "home",
  });
  return `${base}${path}?${params.toString()}`;
}

module.exports = {
  FOOTBALLHUB_BASE_URL,
  youtube,
  footballData,
  ai,
  storage,
  instagram,
  analytics,
  database,
  COMPETITIONS,
  TEAMS,
  QUICK_SEARCHES,
  MEDIA_STATUS,
  PROCESSABLE_RIGHTS,
  PIPELINE,
  utmUrl,
  MINUTE,
  HOUR,
};