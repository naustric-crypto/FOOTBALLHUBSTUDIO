// lib/matchIdentify.js
//
// "Identify Match" — given a YouTube video's title, description, channel
// and publication time, work out competition / home team / away team /
// approximate match date.
//
// Order of operations (per the brief):
//   1. Structured football-data lookup where available.
//   2. If structured data is unavailable, fall back to AI-assisted
//      identification.
//   3. Always allow manual correction in the UI.
//
// Every result carries a source indicator:
//   YouTube | Football API | Both | Manual
//
// The result is a *proposal*. The admin confirms or changes it.

const scoring = require("./scoring");
const footballData = require("../services/football-data");
const ai = require("../services/ai");
const store = require("./store");

const SOURCE = {
  YOUTUBE: "YouTube",
  FOOTBALL_API: "Football API",
  BOTH: "Both",
  MANUAL: "Manual",
};

// Naive but useful: highlight videos usually publish within ~36h of the
// match. We use the publish time as the anchor and let callers widen it.
function approximateMatchDate(publishedAt) {
  if (!publishedAt) return null;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function teamFromField(field) {
  return field && field.value ? field.value : null;
}

// Main entry point. `video` is the stored YouTube record. `opts.allowAi`
// lets the API surface decide whether to spend an AI call.
async function identifyMatch(video, { allowAi = true } = {}) {
  if (!video) return { ok: false, reason: "no video" };

  const analysis = scoring.analyseVideo(video);
  const fields = analysis.fields;

  const youtubeGuess = {
    competition: fields.competition.value,
    home_team: teamFromField(fields.home_team),
    away_team: teamFromField(fields.away_team),
    match_date: fields.match_date.value || approximateMatchDate(video.published_at),
    score: fields.score.value,
    confidence: Number(
      (
        (fields.home_team.confidence +
          fields.away_team.confidence +
          fields.competition.confidence) /
        3
      ).toFixed(2)
    ),
    field_confidence: {
      home_team: fields.home_team.confidence,
      away_team: fields.away_team.confidence,
      competition: fields.competition.confidence,
      match_date: fields.match_date.confidence,
      score: fields.score.confidence,
    },
    category: analysis.category,
    category_confidence: analysis.category_confidence,
    extracted_teams: analysis.extracted_teams,
  };

  // 1) Structured football-data enrichment (optional, non-blocking).
  const fd = await footballData.findMatch({
    homeTeam: youtubeGuess.home_team,
    awayTeam: youtubeGuess.away_team,
    date: youtubeGuess.match_date,
  });

  if (fd.ok && fd.match) {
    const merged = {
      competition: fd.match.competition || youtubeGuess.competition,
      home_team: fd.match.home_team || youtubeGuess.home_team,
      away_team: fd.match.away_team || youtubeGuess.away_team,
      match_date: fd.match.match_date || youtubeGuess.match_date,
      score: fd.match.score && fd.match.score !== "-" ? fd.match.score : youtubeGuess.score,
      venue: fd.match.venue || null,
      football_data_fixture_id: fd.match.football_data_fixture_id,
    };
    return {
      ok: true,
      source: SOURCE.BOTH,
      // Structured facts come first; YouTube-derived values only fill gaps.
      match: merged,
      structured: fd.match,
      youtube: youtubeGuess,
      confidence: Math.max(0.9, youtubeGuess.confidence),
      needs_confirmation: youtubeGuess.confidence < 0.9,
    };
  }

  // 2) AI-assisted identification when structured data is unavailable.
  if (allowAi && ai.enabled) {
    try {
      const aiMatch = await ai.identifyMatch({
        title: video.title,
        description: video.description,
        channel: video.channel_title,
        publishedAt: video.published_at,
      });
      if (aiMatch && (aiMatch.home_team || aiMatch.away_team || aiMatch.competition)) {
        return {
          ok: true,
          source: SOURCE.YOUTUBE, // AI reasoned from YouTube metadata only
          match: {
            competition: aiMatch.competition || youtubeGuess.competition,
            home_team: aiMatch.home_team || youtubeGuess.home_team,
            away_team: aiMatch.away_team || youtubeGuess.away_team,
            match_date: aiMatch.match_date || youtubeGuess.match_date,
            score: aiMatch.score || youtubeGuess.score,
            venue: null,
          },
          structured: null,
          youtube: youtubeGuess,
          ai: aiMatch,
          confidence: Number((aiMatch.confidence ?? 0.6).toFixed ? (aiMatch.confidence ?? 0.6).toFixed(2) : aiMatch.confidence ?? 0.6),
          needs_confirmation: true,
        };
      }
    } catch (err) {
      store.recordError("match-identify-ai", err.message);
    }
  }

  // 3) YouTube-only proposal, explicitly flagged for confirmation.
  return {
    ok: Boolean(youtubeGuess.home_team || youtubeGuess.away_team || youtubeGuess.competition),
    source: SOURCE.YOUTUBE,
    match: {
      competition: youtubeGuess.competition,
      home_team: youtubeGuess.home_team,
      away_team: youtubeGuess.away_team,
      match_date: youtubeGuess.match_date,
      score: youtubeGuess.score,
      venue: null,
    },
    structured: null,
    youtube: youtubeGuess,
    confidence: youtubeGuess.confidence,
    needs_confirmation: true,
    reason: fd.reason || "structured data unavailable",
  };
}

// Build a slug + display title for a confirmed match.
function matchSlug(match) {
  const parts = [match.home_team, match.away_team].filter(Boolean).join("-vs-");
  const base = (parts || "football-match")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const date = match.match_date ? `-${match.match_date}` : "";
  return `${base}${date}`;
}

function buildMatchRecord(video, identified, overrides = {}) {
  const m = identified.match || {};
  const match = {
    home_team: overrides.home_team ?? m.home_team,
    away_team: overrides.away_team ?? m.away_team,
    competition: overrides.competition ?? m.competition,
    match_date: overrides.match_date ?? m.match_date,
    score: overrides.score ?? m.score,
    venue: overrides.venue ?? m.venue ?? null,
    youtube_video_id: video.youtube_video_id,
    source: overrides.source || identified.source,
    confidence: overrides.confidence ?? identified.confidence ?? 0,
    field_confidence: identified.youtube?.field_confidence || {},
    confirmed: Boolean(overrides.confirmed),
  };
  match.slug = overrides.slug || matchSlug(match);
  match.title = [match.home_team, match.away_team].filter(Boolean).join(" vs ") || video.title;
  return match;
}

module.exports = {
  SOURCE,
  identifyMatch,
  approximateMatchDate,
  matchSlug,
  buildMatchRecord,
};