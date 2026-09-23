// services/ai.js
//
// AI service. Used for:
//   1. AI-assisted match identification when structured football-data is
//      unavailable.
//   2. Analysis generation split into FACTS / OBSERVATIONS / INFERENCES,
//      plus the AI match report and social copy.
//
// IMPORTANT: this service must never fabricate statistics. When an AI key
// is absent we fall back to a deterministic, evidence-based generator that
// only restates supplied facts and clearly-labelled observations.

const { ai } = require("../lib/config");
const store = require("../lib/store");

function enabled() {
  return Boolean(ai.apiKey);
}

// Low-level chat call. Throws only on transport failure; callers catch.
async function chat(messages, { temperature = 0.2, json = false } = {}) {
  if (!enabled()) {
    const err = new Error("AI_API_KEY not configured");
    err.code = "AI_DISABLED";
    throw err;
  }
  const res = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify({
      model: ai.model,
      messages,
      temperature,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const msg = `AI request failed: ${res.status}`;
    store.recordError("ai", msg);
    throw new Error(msg);
  }
  const body = await res.json();
  return body.choices?.[0]?.message?.content || "";
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// --- 1) Match identification ------------------------------------------------

async function identifyMatch({ title, description, channel, publishedAt }) {
  if (!enabled()) return heuristicIdentify({ title, description });

  const prompt = `You are a football (soccer) match identification assistant.
Given a YouTube video's metadata, identify the match it refers to.
Only use information present in the metadata. If unsure, use null and a
low confidence. Never invent a scoreline.

Return JSON with:
{"competition":string|null,"home_team":string|null,"away_team":string|null,
 "match_date":"YYYY-MM-DD"|null,"score":"H-A"|null,"confidence":0..1}

TITLE: ${title || ""}
CHANNEL: ${channel || ""}
PUBLISHED_AT: ${publishedAt || ""}
DESCRIPTION: ${(description || "").slice(0, 1500)}`;

  const raw = await chat(
    [
      { role: "system", content: "You output strict JSON only." },
      { role: "user", content: prompt },
    ],
    { json: true, temperature: 0 }
  );
  const parsed = safeJson(raw);
  if (!parsed) return heuristicIdentify({ title, description });
  return parsed;
}

// Deterministic fallback used when AI is off or fails.
function heuristicIdentify({ title = "", description = "" }) {
  const scoring = require("../lib/scoring");
  const ha = scoring.extractHomeAway(title, description);
  const comp = scoring.extractCompetition(title, description);
  const score = scoring.extractScore(title, description);
  return {
    competition: comp.value,
    home_team: ha.home_team,
    away_team: ha.away_team,
    match_date: null,
    score: score.value,
    confidence: ha.confidence,
    _fallback: true,
  };
}

// --- 2) Analysis generation -------------------------------------------------

async function generateAnalysis({ match, video, structured, footageEvents, notes }) {
  const facts = buildFacts({ match, video, structured });
  const observations = buildObservations({ footageEvents });

  if (enabled()) {
    try {
      const prompt = `You are a football analyst. Produce a cautious analysis.
STRICT RULES:
- FACTS may only come from the supplied structured data and video metadata.
- OBSERVATIONS describe what is visible in supplied footage events.
- INFERENCES are reasoned conclusions; label uncertainty. Never invent stats.

Return JSON:
{"facts":[string],"observations":[string],"inferences":[string],
 "summary":string,"key_moments":[string],"tactical_analysis":string,
 "team_analysis":string,"player_analysis":string,"decided_by":string,
 "three_moments":[string],"tactical_adjustment":string,
 "further_questions":[string]}

MATCH: ${JSON.stringify(match || {})}
VIDEO: ${JSON.stringify({ title: video?.title, channel: video?.channel_title })}
STRUCTURED: ${JSON.stringify(structured || null)}
FOOTAGE_EVENTS: ${JSON.stringify((footageEvents || []).slice(0, 40))}
NOTES: ${(notes || "").slice(0, 2000)}`;

      const raw = await chat(
        [
          {
            role: "system",
            content: "You are a meticulous, cautious football analyst. Output strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
        { json: true, temperature: 0.3 }
      );
      const parsed = safeJson(raw);
      if (parsed) {
        return {
          facts: unique([...facts, ...(parsed.facts || [])]),
          observations: [...observations, ...(parsed.observations || [])],
          inferences: parsed.inferences || [],
          report: {
            summary: parsed.summary || "",
            key_moments: parsed.key_moments || [],
            tactical_analysis: parsed.tactical_analysis || "",
            team_analysis: parsed.team_analysis || "",
            player_analysis: parsed.player_analysis || "",
            decided_by: parsed.decided_by || "",
            three_moments: parsed.three_moments || [],
            tactical_adjustment: parsed.tactical_adjustment || "",
            further_questions: parsed.further_questions || [],
          },
          ai_used: true,
        };
      }
    } catch (err) {
      store.recordError("ai-analysis", err.message);
    }
  }

  return {
    facts,
    observations,
    inferences: observations.length
      ? ["Tactical intent cannot be confirmed without authorized footage."]
      : [],
    report: fallbackReport({ match, video, structured, observations }),
    ai_used: false,
  };
}

function buildFacts({ match, video, structured }) {
  const facts = [];
  const s = structured || {};
  const m = match || {};
  if (s.competition || m.competition) facts.push(`Competition: ${s.competition || m.competition}`);
  if (s.home_team || m.home_team) facts.push(`Home team: ${s.home_team || m.home_team}`);
  if (s.away_team || m.away_team) facts.push(`Away team: ${s.away_team || m.away_team}`);
  const score = s.score || m.score;
  if (score && score !== "-") facts.push(`Final score: ${score}`);
  if (s.match_date || m.match_date) facts.push(`Match date: ${s.match_date || m.match_date}`);
  if (s.venue) facts.push(`Venue: ${s.venue}`);
  if (video?.title) facts.push(`Source video: "${video.title}"`);
  if (video?.channel_title) facts.push(`Source channel: ${video.channel_title}`);
  if (video?.published_at) facts.push(`Video published: ${video.published_at}`);
  return facts;
}

function buildObservations({ footageEvents }) {
  if (!footageEvents?.length) return [];
  const byType = {};
  for (const e of footageEvents) {
    byType[e.event_type] = (byType[e.event_type] || 0) + 1;
  }
  return Object.entries(byType).map(
    ([type, count]) => `${count} ${type.replace(/_/g, " ")} event(s) detected in supplied footage.`
  );
}

function fallbackReport({ match, video, structured, observations }) {
  const title =
    [match?.home_team, match?.away_team].filter(Boolean).join(" vs ") ||
    video?.title ||
    "the match";
  const score = structured?.score || match?.score;
  const line =
    `This analysis of ${title}${score && score !== "-" ? ` (${score})` : ""} was generated from ` +
    `YouTube metadata${structured ? " and structured match data" : ""}.` +
    (observations.length ? "" : " Video-level tactical analysis requires authorized source footage.");
  return {
    summary: line,
    key_moments: [],
    tactical_analysis: observations.length
      ? "Derived from supplied footage events only."
      : "Video-level tactical analysis requires authorized source footage.",
    team_analysis: "",
    player_analysis: "",
    decided_by: "",
    three_moments: [],
    tactical_adjustment: "",
    further_questions: [
      "Which phases of play decided the match?",
      "How did each side adjust after conceding?",
    ],
  };
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// --- 3) Social content ------------------------------------------------------

async function generateSocial({ match, report, slug, utmUrls }) {
  if (enabled()) {
    try {
      const prompt = `Create social content driving traffic to FootballHub.
Return JSON:
{"reel":{"hook":string,"script":string,"narration":string,"on_screen_text":[string],
"caption":string,"hashtags":[string],"cta":string},
"short":{"title":string,"description":string,"script":string,"thumbnail_text":string,
"hashtags":[string],"url":string}}

CTA must include this URL: ${utmUrls.instagram}
MATCH: ${JSON.stringify(match)}
SUMMARY: ${report?.summary || ""}
SLUG: ${slug}`;
      const raw = await chat(
        [
          {
            role: "system",
            content: "You are a football social media producer. Output strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
        { json: true, temperature: 0.7 }
      );
      const parsed = safeJson(raw);
      if (parsed) return parsed;
    } catch (err) {
      store.recordError("ai-social", err.message);
    }
  }
  return fallbackSocial({ match, slug, utmUrls });
}

function fallbackSocial({ match, slug, utmUrls }) {
  const title =
    [match?.home_team, match?.away_team].filter(Boolean).join(" vs ") || "Football";
  const score = match?.score && match.score !== "-" ? ` (${match.score})` : "";
  const hashtags = [
    "#football",
    "#soccer",
    "#matchanalysis",
    ...(match?.competition ? [`#${match.competition.replace(/\s+/g, "")}`] : []),
  ];
  return {
    reel: {
      hook: `${title}${score} — here's what actually decided it.`,
      script:
        "Open on the key moment. Explain the setup. Show the turning point. Close with the full breakdown.",
      narration: `Full breakdown of ${title}${score}.`,
      on_screen_text: [title, "Key moment", "Full breakdown on FootballHub"],
      caption: `${title}${score} — full tactical breakdown on FootballHub.`,
      hashtags,
      cta: `Full breakdown on FootballHub: ${utmUrls.instagram}`,
    },
    short: {
      title: `${title}${score} | Full Breakdown`,
      description: `Tactical breakdown of ${title}${score}. Full analysis on FootballHub.`,
      script: "Intro the fixture, show the decisive sequence, explain the adjustment.",
      thumbnail_text: title,
      hashtags,
      url: utmUrls.youtube,
    },
  };
}

module.exports = {
  enabled,
  chat,
  identifyMatch,
  heuristicIdentify,
  generateAnalysis,
  generateSocial,
  fallbackSocial,
};