// api/analysis/[id].js
// Fetch an analysis by id, or an analysis + match by ?slug=.
// Also returns the pipeline record so the UI can render the stage.
const store = require("../../lib/store");
const studio = require("../../lib/studio");
const { FOOTBALLHUB_BASE_URL } = require("../../lib/config");

module.exports = async (req, res) => {
  const { id } = req.query;
  const q = req.query || {};

  try {
    // Analyses are written by the studio (Netlify); hydrate before reading.
    if (store.whenReady) await store.whenReady();
    let analysis;
    if (q.slug) {
      analysis = studio.getAnalysisBySlug(q.slug) || store.getAnalysis(q.slug);
    } else {
      analysis = store.getAnalysis(id);
    }
    if (!analysis) return res.status(404).json({ error: "analysis not found" });

    const match = store.getMatch(analysis.match_id);
    const content =
      store.listContent(500).find((c) => c.analysis_id === analysis.id) || null;
    // Pipeline is keyed by youtube_video_id (the discovered entity).
    const pipeline = store.getPipeline(analysis.youtube_video_id);

    res.status(200).json({ analysis, match, content, pipeline, funnel_base: FOOTBALLHUB_BASE_URL });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};