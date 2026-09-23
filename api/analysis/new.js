// api/analysis/new.js
// Create a new analysis (POST) combining YouTube + optional football-data
// + authorized footage + AI reasoning.
const studio = require("../../lib/studio");

module.exports = async (req, res) => {
  const body = req.body || {};
  const videoId = body.videoId || req.query?.videoId;
  if (!videoId) return res.status(400).json({ error: "videoId required" });

  try {
    const result = await studio.analyse({
      videoId,
      assetId: body.assetId || null,
      footageEvents: body.footageEvents || [],
      notes: body.notes || "",
      manualMatch: body.manualMatch || null,
    });
    res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
};