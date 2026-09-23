// services/analytics.js
//
// First-party traffic tracking so we can prove the social funnel works:
// every social item carries UTM params, and landing pages report back.
// We record: landing_page_view, source, medium, campaign, content, match_id.

const store = require("../lib/store");
const { FOOTBALLHUB_BASE_URL } = require("../lib/config");

// Record a landing-page view coming in from a social source.
function recordLandingView({ source, medium, campaign, content, matchId, path }) {
  return store.trackEvent({
    landing_page_view: true,
    source,
    medium,
    campaign,
    content,
    match_id: matchId,
    path,
  });
}

// Parse UTM params out of a query object (from a Vercel request).
function fromQuery(query = {}) {
  return {
    source: query.utm_source || "direct",
    medium: query.utm_medium || "none",
    campaign: query.utm_campaign || "",
    content: query.utm_content || "",
    matchId: query.match_id || query.utm_content || "",
  };
}

function summary() {
  return store.analyticsSummary();
}

// Count views attributable to each social source (instagram / youtube).
function funnel() {
  const s = summary();
  const sumFor = (prefix) =>
    Object.entries(s.by_source)
      .filter(([k]) => k.startsWith(prefix))
      .reduce((a, [, v]) => a + v, 0);
  return {
    total: s.total,
    instagram: sumFor("instagram"),
    youtube: sumFor("youtube"),
    by_source: s.by_source,
  };
}

module.exports = {
  recordLandingView,
  fromQuery,
  summary,
  funnel,
  FOOTBALLHUB_BASE_URL,
};