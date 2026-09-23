// services/video.js
//
// Authorized-footage analysis.
//
// Hard rule from the brief: for third-party YouTube videos that are
// EMBED_ONLY, we DO NOT download them and we do not run computer vision on
// them. The only footage we can process is footage the administrator has
// uploaded and marked OWNED / LICENSED / PERMISSION_GRANTED / PUBLIC_DOMAIN.
//
// The computer-vision step itself needs heavier infrastructure than a
// Vercel function. This module therefore:
//   * enforces the rights gate,
//   * accepts externally-produced event lists (from a CV worker) and
//     normalises them,
//   * and returns a clear "not available" result rather than pretending.

const { PROCESSABLE_RIGHTS } = require("../lib/config");

const EVENT_TYPES = [
  "goal",
  "shot",
  "chance",
  "transition",
  "pressing",
  "defensive_shape",
  "attacking_shape",
  "build_up",
  "set_piece",
  "tactical_change",
  "important_sequence",
  "player_action",
];

function canProcess(mediaStatus) {
  return PROCESSABLE_RIGHTS.has(mediaStatus);
}

// Normalise a raw CV event into the required event shape:
// timestamp, event_type, team, players, evidence, confidence, source.
function normalizeEvent(raw = {}) {
  const players = Array.isArray(raw.players)
    ? raw.players
    : raw.player
    ? [{ name: raw.player, confidence: raw.player_confidence ?? 0.5 }]
    : [];
  return {
    timestamp: raw.timestamp ?? raw.time ?? null,
    event_type: EVENT_TYPES.includes(raw.event_type) ? raw.event_type : "player_action",
    team: raw.team || null,
    players,
    evidence: raw.evidence || raw.description || "",
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    source: raw.source || "computer_vision",
  };
}

// Entry point for an uploaded-footage record from services/storage.
function analyseUploadedFootage(asset, providedEvents = []) {
  if (!asset) return { ok: false, reason: "no asset" };
  if (!canProcess(asset.media_status)) {
    return {
      ok: false,
      reason:
        `Media status ${asset.media_status} does not permit processing. ` +
        "Only OWNED, LICENSED, PERMISSION_GRANTED or PUBLIC_DOMAIN footage may be analysed.",
    };
  }

  const events = providedEvents.map(normalizeEvent);

  if (!events.length) {
    return {
      ok: true,
      events: [],
      available: false,
      message:
        "Footage is authorized, but no computer-vision worker has produced events yet. " +
        "Deeper analysis is enabled once the worker returns results.",
    };
  }

  return { ok: true, events, available: true };
}

// For EMBED_ONLY YouTube videos: refuse deeper processing and return the
// "requires authorized footage" notice used in the UI.
function embedOnlyAnalysis(video) {
  return {
    ok: true,
    available: false,
    embed_only: true,
    youtube_video_id: video?.youtube_video_id,
    message: "Video-level tactical analysis requires authorized source footage.",
  };
}

// Choose the right path based on media rights.
function buildAnalysisSource(video, asset, providedEvents) {
  if (video && video.media_status === "EMBED_ONLY") {
    return embedOnlyAnalysis(video);
  }
  if (asset) return analyseUploadedFootage(asset, providedEvents);
  return {
    ok: true,
    available: false,
    message: "No authorized footage supplied. Analysis will use metadata only.",
  };
}

module.exports = {
  EVENT_TYPES,
  canProcess,
  normalizeEvent,
  analyseUploadedFootage,
  embedOnlyAnalysis,
  buildAnalysisSource,
};