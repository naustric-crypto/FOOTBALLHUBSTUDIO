// lib/scoring.js
//
// YouTube content scoring + field extraction.
//
// Two jobs:
//   1. Classify a discovered video into one of the football content
//      categories the newsroom cares about.
//   2. Extract candidate home_team / away_team / competition / match_date /
//      score from the title + description.
//
// CRITICAL: extracted values are NEVER assumed correct. Every extracted
// field carries a confidence value (0..1) so the admin UI can show it and
// ask for confirmation. Nothing downstream may treat an extraction as a
// confirmed fact.

const { COMPETITIONS, TEAMS } = require("./config");

// Football content categories, in rough priority order.
const CATEGORIES = [
  "MATCH_HIGHLIGHT",
  "GOAL_COMPILATION",
  "POST_MATCH_ANALYSIS",
  "PRESS_CONFERENCE",
  "TRANSFER_NEWS",
  "TACTICAL_ANALYSIS",
  "FOOTBALL_NEWS",
  "OTHER",
];

// Keyword signals per category. Weights let a strong signal dominate.
const SIGNALS = {
  MATCH_HIGHLIGHT: [
    [/highlights?/i, 3],
    [/\bextended\b/i, 2],
    [/\ball goals\b/i, 2],
    [/\bmatch\s+highlights\b/i, 4],
    [/\bvs\.?\b/i, 1],
  ],
  GOAL_COMPILATION: [
    [/\ball goals\b/i, 3],
    [/\bgoals?\s+compilation\b/i, 4],
    [/\bevery goal\b/i, 4],
    [/\btop\s+goals\b/i, 3],
  ],
  POST_MATCH_ANALYSIS: [
    [/\banalysis\b/i, 2],
    [/\bpost[-\s]?match\b/i, 4],
    [/\breaction\b/i, 2],
    [/\bbreakdown\b/i, 3],
    [/\bwhat\s+went\s+wrong\b/i, 3],
  ],
  PRESS_CONFERENCE: [
    [/\bpress\s+conference\b/i, 5],
    [/\bpre[-\s]?match\s+press\b/i, 4],
    [/\bpost[-\s]?match\s+press\b/i, 4],
  ],
  TRANSFER_NEWS: [
    [/\btransfer\b/i, 4],
    [/\bsign(s|ed|ing)\b/i, 3],
    [/\bdeal\b/i, 2],
    [/\brumou?rs?\b/i, 3],
    [/\bmedical\b/i, 2],
  ],
  TACTICAL_ANALYSIS: [
    [/\btactic(s|al)\b/i, 4],
    [/\bformation\b/i, 3],
    [/\bhow\s+.+\s+beat\b/i, 3],
    [/\btactical\s+analysis\b/i, 5],
    [/\bxG\b/, 2],
  ],
  FOOTBALL_NEWS: [
    [/\bnews\b/i, 2],
    [/\btransfer\s+news\b/i, 2],
    [/\binjur(y|ies)\b/i, 2],
    [/\bsack(ed)?\b/i, 2],
  ],
};

// Competition keyword map derived from config (so it stays in one place).
const COMPETITION_SIGNALS = COMPETITIONS.map((c) => ({
  name: c.name,
  region: c.region,
  patterns: c.keywords.map((k) => new RegExp(k.replace(/\s+/g, "\\s+"), "i")),
}));

// Score a video's text against each category. Returns the best category
// plus a confidence value and the full score breakdown.
function scoreCategories({ title = "", description = "", tags = [] } = {}) {
  const text = `${title}\n${description}\n${tags.join(" ")}`;
  const scores = {};

  for (const [category, rules] of Object.entries(SIGNALS)) {
    let score = 0;
    for (const [re, weight] of rules) {
      if (re.test(text)) score += weight;
    }
    scores[category] = score;
  }

  // A mention of two teams + a score strongly implies a highlight.
  const teams = extractTeams(title, description);
  if (teams.length >= 2) scores.MATCH_HIGHLIGHT += 2;
  if (looksLikeScore(title)) scores.MATCH_HIGHLIGHT += 2;

  let best = "OTHER";
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }

  // Confidence: share of total signal mass captured by the winner, damped
  // when the signal is very weak so "OTHER" never looks overconfident.
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  let confidence = total > 0 ? bestScore / total : 0;
  if (bestScore < 2) confidence = Math.min(confidence, 0.35);
  confidence = Number(confidence.toFixed(2));

  return { category: best, confidence, scores };
}

function extractTeams(title = "", description = "") {
  const text = `${title} ${description}`;
  const found = [];
  for (const team of TEAMS) {
    const re = new RegExp(team.replace(/\s+/g, "\\s+"), "i");
    if (re.test(text)) found.push(team);
  }
  return found;
}

function extractCompetition(title = "", description = "") {
  const text = `${title} ${description}`;
  for (const c of COMPETITION_SIGNALS) {
    if (c.patterns.some((re) => re.test(text))) {
      return { value: c.name, confidence: 0.9, region: c.region };
    }
  }
  // "Premier League" style fallback when only the words appear.
  const m = text.match(/\b(premier league|champions league|la liga|serie a|bundesliga|ligue 1)\b/i);
  if (m) return { value: titleCase(m[1]), confidence: 0.6, region: null };
  return { value: null, confidence: 0, region: null };
}

// Detect "2-1", "2–1", "3 - 0" scorelines.
function looksLikeScore(title = "") {
  return /\b\d{1,2}\s*[-–:]\s*\d{1,2}\b/.test(title);
}

function extractScore(title = "", description = "") {
  const text = `${title} ${description}`;
  const m = text.match(/\b(\d{1,2})\s*[-–:]\s*(\d{1,2})\b/);
  if (!m) return { value: null, confidence: 0 };
  const value = `${m[1]}-${m[2]}`;
  // A bare scoreline in a title is suggestive, not authoritative.
  const confident = looksLikeScore(title);
  return { value, confidence: confident ? 0.7 : 0.4 };
}

// Extract a date hint (YYYY-MM-DD, DD/MM/YYYY, "23 September 2026").
function extractMatchDate(title = "", description = "") {
  const text = `${title} ${description}`;

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return { value: `${iso[1]}-${iso[2]}-${iso[3]}`, confidence: 0.85 };

  const dmy = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  if (dmy) {
    const dd = String(dmy[1]).padStart(2, "0");
    const mm = String(dmy[2]).padStart(2, "0");
    return { value: `${dmy[3]}-${mm}-${dd}`, confidence: 0.7 };
  }

  const long = text.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  if (long) {
    const months = {
      january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
      july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
    };
    const dd = String(long[1]).padStart(2, "0");
    const mm = months[long[2].toLowerCase()];
    return { value: `${long[3]}-${mm}-${dd}`, confidence: 0.75 };
  }

  return { value: null, confidence: 0 };
}

// Try to split "A vs B" / "A v B" / "A - B" into home/away.
function extractHomeAway(title = "", description = "") {
  const text = title || description;
  const m = text.match(/([A-Za-z0-9 .'&-]{2,40}?)\s+(?:vs\.?|v\.?|against)\s+([A-Za-z0-9 .'&-]{2,40})/i);
  if (!m) return { home_team: null, away_team: null, confidence: 0 };

  const clean = (s) => s.replace(/[-–|:].*$/, "").trim();
  const home = clean(m[1]);
  const away = clean(m[2]);

  const known = extractTeams(home, away);
  const confidence = known.length >= 2 ? 0.8 : known.length === 1 ? 0.5 : 0.3;
  return { home_team: home, away_team: away, confidence };
}

function titleCase(s = "") {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

// Full scoring pass over a video -> one object the UI and store can use.
function analyseVideo(video = {}) {
  const { category, confidence: categoryConfidence, scores } = scoreCategories(video);
  const homeAway = extractHomeAway(video.title || "", video.description || "");
  const competition = extractCompetition(video.title || "", video.description || "");
  const score = extractScore(video.title || "", video.description || "");
  const matchDate = extractMatchDate(video.title || "", video.description || "");

  // Field-level confidence table, as required by the brief.
  const fields = {
    home_team: { value: homeAway.home_team, confidence: homeAway.confidence },
    away_team: { value: homeAway.away_team, confidence: homeAway.confidence },
    competition: { value: competition.value, confidence: competition.confidence },
    match_date: { value: matchDate.value, confidence: matchDate.confidence },
    score: { value: score.value, confidence: score.confidence },
  };

  return {
    category,
    category_confidence: categoryConfidence,
    category_scores: scores,
    fields,
    extracted_teams: extractTeams(video.title || "", video.description || ""),
  };
}

module.exports = {
  CATEGORIES,
  scoreCategories,
  extractTeams,
  extractCompetition,
  extractScore,
  extractMatchDate,
  extractHomeAway,
  analyseVideo,
  looksLikeScore,
};