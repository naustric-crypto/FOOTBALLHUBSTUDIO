// api/article/index.js
// Public article data for /analysis/[slug]. Only PUBLISHED analyses are
// returned to the public surface.
const store = require("../../lib/store");
const studio = require("../../lib/studio");

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    const slug = q.slug || q.id;
    if (!slug) return res.status(400).json({ error: "slug required" });

    const analysis = studio.getAnalysisBySlug(slug) || store.getAnalysis(slug);
    if (!analysis) return res.status(404).json({ error: "not found" });

    const pipeline = store.getPipeline(analysis.youtube_video_id);
    const published = pipeline?.stage === "PUBLISHED";

    const match = store.getMatch(analysis.match_id);
    const video = store.getVideo(analysis.youtube_video_id);
    const content = store.listContent(500).find((c) => c.analysis_id === analysis.id) || null;

    // Related matches: same competition, different slug.
    const related = store
      .listMatches(50)
      .filter((m) => m.competition && m.competition === match?.competition && m.slug !== slug)
      .slice(0, 5);

    res.status(200).json({
      published,
      article: {
        slug,
        match,
        youtube: video
          ? {
              title: video.title,
              channel: video.channel_title,
              published_at: video.published_at,
              thumbnail: video.thumbnail,
              embed_url: video.embed_url,
              youtube_url: video.youtube_url,
              media_status: video.media_status,
            }
          : null,
        facts: analysis.facts,
        observations: analysis.observations,
        inferences: analysis.inferences,
        report: analysis.report,
        key_events: analysis.footage?.events || [],
        social: content,
      },
      related,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};