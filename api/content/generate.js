// api/content/generate.js
// Generate social content (Instagram Reel + YouTube Short + FootballHub
// article package) from a finished analysis. No auto-publication.
const studio = require("../../lib/studio");

module.exports = async (req, res) => {
  const body = req.body || {};
  const analysisId = body.analysisId || req.query?.analysisId;
  if (!analysisId) return res.status(400).json({ error: "analysisId required" });

  try {
    const result = await studio.generateContent(analysisId);
    res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
};