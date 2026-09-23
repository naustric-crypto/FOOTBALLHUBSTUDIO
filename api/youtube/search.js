// api/youtube/search.js
// YouTube-first discovery: keyword/date/region/language/pagination search.
const studio = require("../../lib/studio");
const { QUICK_SEARCHES } = require("../../lib/config");

module.exports = async (req, res) => {
  const q = req.query || {};
  const query = q.q || q.query || "football highlights";
  try {
    const result = await studio.discover({
      query,
      maxResults: q.maxResults,
      publishedAfter: q.publishedAfter,
      publishedBefore: q.publishedBefore,
      region: q.region,
      language: q.language,
      pageToken: q.pageToken,
      order: q.order,
      type: q.type,
      videoCategoryId: q.videoCategoryId,
      eventType: q.eventType,
    });
    res.status(200).json({
      source: "YouTube",
      query,
      quick_searches: QUICK_SEARCHES,
      response: result.items,
      nextPageToken: result.nextPageToken,
      cached: result.cached,
    });
  } catch (err) {
    if (err.code === "YOUTUBE_DISABLED") {
      return res.status(200).json({
        source: "YouTube",
        configured: false,
        response: [],
        quick_searches: QUICK_SEARCHES,
        notice: err.message,
      });
    }
    res.status(502).json({ error: err.message, response: [] });
  }
};