// api/analytics.js
// First-party analytics: record landing-page views from social traffic and
// report the funnel. GET returns a summary; POST records a view.
const store = require("../lib/store");
const analytics = require("../services/analytics");

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  try {
    // Shared store first: the funnel must include events recorded by the
    // OTHER deployment (landing views happen on the official website).
    if (store.whenReady) await store.whenReady();
    if (method === "GET") {
      return res.status(200).json({
        summary: analytics.summary(),
        funnel: analytics.funnel(),
      });
    }

    // POST: record a landing page view (also accepts beacon-style body).
    const body = req.body || {};
    const parsed = analytics.fromQuery(body.query || body);
    const event = analytics.recordLandingView({
      source: body.source || parsed.source,
      medium: body.medium || parsed.medium,
      campaign: body.campaign || parsed.campaign,
      content: body.content || parsed.content,
      matchId: body.match_id || parsed.matchId,
      path: body.path || "",
    });
    res.status(200).json({ ok: true, event, summary: store.analyticsSummary() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};