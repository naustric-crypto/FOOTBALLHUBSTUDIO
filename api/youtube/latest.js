// api/youtube/latest.js
// "Latest Football" dashboard feed: multi-competition recent discovery.
const studio = require("../../lib/studio");
const { COMPETITIONS, QUICK_SEARCHES, youtube } = require("../../lib/config");

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    // Default: search a couple of the biggest competitions for the newest
    // videos. Callers can override with ?q=...
    const queries = q.q
      ? [q.q]
      : COMPETITIONS.slice(0, 3).map((c) => `${c.name} highlights`);
    const perQuery = Math.max(2, Math.floor((Number(q.maxResults) || 12) / queries.length));

    const seen = new Set();
    const items = [];
    for (const query of queries) {
      const result = await studio.discover({ query, maxResults: perQuery });
      for (const v of result.items) {
        if (seen.has(v.youtube_video_id)) continue;
        seen.add(v.youtube_video_id);
        items.push(v);
      }
    }
    items.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    res.status(200).json({
      source: "YouTube",
      poll_seconds: youtube.poll.latestSeconds,
      competitions: COMPETITIONS,
      quick_searches: QUICK_SEARCHES,
      response: items,
    });
  } catch (err) {
    if (err.code === "YOUTUBE_DISABLED") {
      return res.status(200).json({
        configured: false,
        response: [],
        competitions: COMPETITIONS,
        quick_searches: QUICK_SEARCHES,
        notice: err.message,
      });
    }
    res.status(200).json({ error: err.message, response: [] });
  }
};