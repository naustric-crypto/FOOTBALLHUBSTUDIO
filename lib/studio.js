// lib/studio.js
//
// Analyst Studio orchestration. This is the "newsroom" that ties the
// services together into the required pipeline:
//
//   DISCOVERED -> MATCH IDENTIFIED -> ANALYSIS READY -> CONTENT GENERATED
//   -> ADMIN REVIEW -> APPROVED -> PUBLISHED
//
// Nothing here publishes automatically. Every transition is recorded in
// lib/store's pipeline, and each generated artifact carries a UTM-tagged
// FootballHub link so the social funnel is measurable.

const store = require("./store");
const config = require("./config");
const scoring = require("./scoring");
const matchIdentify = require("./matchIdentify");
const youtube = require("../services/youtube");
const ai = require("../services/ai");
const videoService = require("../services/video");
const instagram = require("../services/instagram");
const storage = require("../services/storage");

// --- Discovery --------------------------------------------------------------

// Discover recent videos for a keyword, scoring + storing each one.
async function discover({
  query,
  maxResults,
  publishedAfter,
  publishedBefore,
  region,
  language,
  pageToken,
  order,
  type,
  videoCategoryId,
  eventType,
}) {
  const res = await youtube.search({
    query,
    maxResults,
    publishedAfter,
    publishedBefore,
    regionCode: region,
    relevanceLanguage: language,
    pageToken,
    order,
    type,
    videoCategoryId,
    eventType,
  });

  const items = [];
  for (const v of res.items) {
    const analysis = scoring.analyseVideo(v);
    const stored = await store.upsertVideo({
      ...v,
      category: analysis.category,
      category_confidence: analysis.category_confidence,
      extracted: analysis.fields,
    });
    await store.setPipelineStage(stored.youtube_video_id, "DISCOVERED", {
      query,
      category: analysis.category,
    });
    items.push(stored);
  }

  return { items, nextPageToken: res.nextPageToken, cached: res._cached, query };
}

// Poll a known channel's uploads (cheap) instead of re-searching.
async function discoverChannel(channelId, { maxResults } = {}) {
  const res = await youtube.listChannelUploads(channelId, { maxResults });
  const items = [];
  for (const v of res.items) {
    const analysis = scoring.analyseVideo(v);
    const stored = await store.upsertVideo({
      ...v,
      category: analysis.category,
      category_confidence: analysis.category_confidence,
      extracted: analysis.fields,
    });
    await store.setPipelineStage(stored.youtube_video_id, "DISCOVERED", {
      channel: channelId,
    });
    items.push(stored);
  }
  return { items, nextPageToken: res.nextPageToken, channelId };
}

// --- Match identification ---------------------------------------------------

async function safeGetVideo(videoId) {
  try {
    return await youtube.getVideo(videoId);
  } catch {
    return null;
  }
}

async function identify(videoId, { allowAi = true } = {}) {
  const video = (await safeGetVideo(videoId)) || store.getVideo(videoId);
  if (!video) return { ok: false, reason: "video not found" };

  const identified = await matchIdentify.identifyMatch(video, { allowAi });
  let match = null;
  if (identified.ok) {
    match = await store.saveMatch(
      matchIdentify.buildMatchRecord(video, identified, {
        confirmed: !identified.needs_confirmation,
      })
    );
    await store.setPipelineStage(videoId, "MATCH IDENTIFIED", {
      match_id: match.id,
      source: identified.source,
    });
  }
  return { ok: identified.ok, identified, match, video };
}

// Admin correction of a match proposal.
async function confirmMatch(matchId, overrides = {}) {
  const existing = store.getMatch(matchId);
  if (!existing) return { ok: false, reason: "match not found" };
  const updated = await store.saveMatch({
    ...existing,
    ...overrides,
    source: overrides.source || matchIdentify.SOURCE.MANUAL,
    confirmed: true,
    slug: matchIdentify.matchSlug({ ...existing, ...overrides }),
  });
  await store.setPipelineStage(updated.youtube_video_id, "MATCH IDENTIFIED", {
    match_id: updated.id,
    confirmed: true,
    source: updated.source,
  });
  return { ok: true, match: updated };
}

// --- Analysis ---------------------------------------------------------------

async function analyse({ videoId, assetId, footageEvents = [], notes = "", manualMatch = null }) {
  const video = (await safeGetVideo(videoId)) || store.getVideo(videoId);
  if (!video) return { ok: false, reason: "video not found" };

  let match = store.listMatches(200).find((m) => m.youtube_video_id === videoId);
  if (manualMatch) {
    match = await store.saveMatch({
      ...(match || {}),
      ...manualMatch,
      youtube_video_id: videoId,
      source: matchIdentify.SOURCE.MANUAL,
      confirmed: true,
      slug: matchIdentify.matchSlug(manualMatch),
    });
  }
  if (!match) {
    const identified = await matchIdentify.identifyMatch(video, { allowAi: false });
    match = await store.saveMatch(
      matchIdentify.buildMatchRecord(video, identified, { confirmed: false })
    );
  }

  // Footage path: rights-gated.
  const asset = assetId ? storage.getAsset(assetId) : null;
  const source = videoService.buildAnalysisSource(video, asset, footageEvents);

  const generated = await ai.generateAnalysis({
    match,
    video,
    structured: match.structured || null,
    footageEvents: source.events || [],
    notes,
  });

  const analysis = await store.saveAnalysis({
    id: store.id("analysis"),
    match_id: match.id,
    slug: match.slug,
    youtube_video_id: videoId,
    source_indicator: match.source,
    facts: generated.facts,
    observations: generated.observations,
    inferences: generated.inferences,
    report: generated.report,
    footage: {
      available: source.available || false,
      embed_only: source.embed_only || false,
      message: source.message || null,
      events: source.events || [],
    },
    ai_used: generated.ai_used,
    notes,
  });

  await store.setPipelineStage(videoId, "ANALYSIS READY", {
    analysis_id: analysis.id,
    match_id: match.id,
  });

  return { ok: true, analysis, match, video };
}

function getAnalysisBySlug(slug) {
  return store.listAnalyses(500).find((a) => a.slug === slug) || null;
}

// --- Content generation -----------------------------------------------------

async function generateContent(analysisId) {
  const analysis = store.getAnalysis(analysisId);
  if (!analysis) return { ok: false, reason: "analysis not found" };
  const match = store.getMatch(analysis.match_id) || { slug: analysis.slug };

  const utmUrls = {
    instagram: config.utmUrl(analysis.slug, "instagram"),
    youtube: config.utmUrl(analysis.slug, "youtube"),
  };

  const social = await ai.generateSocial({
    match,
    report: analysis.report,
    slug: analysis.slug,
    utmUrls,
  });

  const content = await store.saveContent({
    id: store.id("content"),
    analysis_id: analysis.id,
    match_id: match.id,
    slug: analysis.slug,
    reel: { ...social.reel, tracking_url: utmUrls.instagram },
    short: { ...social.short, url: utmUrls.youtube },
    youtube_url: utmUrls.youtube,
    instagram_package: instagram.buildPackage({ content: social, slug: analysis.slug, match }),
    status: "READY_FOR_REVIEW",
  });

  await store.setPipelineStage(analysis.youtube_video_id, "CONTENT GENERATED", {
    content_id: content.id,
  });
  await store.setPipelineStage(analysis.youtube_video_id, "ADMIN REVIEW", {
    content_id: content.id,
  });

  return { ok: true, content, analysis, match };
}

// --- Approve / publish (manual only) ----------------------------------------

async function approve(entityId, { approvedBy = "admin" } = {}) {
  return store.setPipelineStage(entityId, "APPROVED", { approved_by: approvedBy });
}

async function publish(entityId, { approved = false, approvedBy = "admin" } = {}) {
  if (!approved) {
    return { ok: false, reason: "Publication requires explicit admin approval." };
  }
  const stage = await store.setPipelineStage(entityId, "PUBLISHED", {
    published_at: store.nowIso(),
    approved_by: approvedBy,
  });
  return { ok: true, stage };
}

module.exports = {
  discover,
  discoverChannel,
  identify,
  confirmMatch,
  analyse,
  getAnalysisBySlug,
  generateContent,
  approve,
  publish,
  safeGetVideo,
};