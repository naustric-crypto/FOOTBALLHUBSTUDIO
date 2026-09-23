// api/match/identify.js
// "Identify Match": given a YouTube video id, propose a match.
const studio = require("../../lib/studio");

module.exports = async (req, res) => {
  const q = req.query || {};
  const body = req.body || {};
  const videoId = q.videoId || body.videoId || q.id;
  if (!videoId) return res.status(400).json({ error: "videoId required" });

  try {
    const result = await studio.identify(videoId, {
      allowAi: q.allowAi !== "0" && body.allowAi !== false,
    });
    if (!result.ok) {
      return res.status(200).json({
        ok: false,
        source: "YouTube",
        reason: result.reason || "could not identify",
        identified: result.identified || null,
      });
    }
    res.status(200).json({
      ok: true,
      source: result.identified.source,
      identified: result.identified,
      match: result.match,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
};