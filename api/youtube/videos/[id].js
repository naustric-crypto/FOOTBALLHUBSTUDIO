// api/youtube/videos/[id].js
// Single video: metadata, scoring, and match-identification proposal.
const store = require("../../../lib/store");
const studio = require("../../../lib/studio");
const scoring = require("../../../lib/scoring");
const { MEDIA_STATUS } = require("../../../lib/config");

module.exports = async (req, res) => {
  const { id } = req.query;
  const q = req.query || {};
  if (!id) return res.status(400).json({ error: "video id required" });

  try {
    const video = (await studio.safeGetVideo(id)) || store.getVideo(id);
    if (!video) return res.status(404).json({ error: "video not found" });

    const scored = scoring.analyseVideo(video);

    // Optional inline identification (?identify=1) with AI allowance.
    let identified = null;
    if (q.identify === "1") {
      identified = await studio.identify(id, { allowAi: q.allowAi !== "0" });
    }

    res.status(200).json({
      source: "YouTube",
      video,
      scoring: scored,
      media_status: video.media_status || MEDIA_STATUS.EMBED_ONLY,
      identified: identified ? identified.identified : null,
      match: identified ? identified.match : null,
      embed_url: video.embed_url,
      youtube_url: video.youtube_url,
    });
  } catch (err) {
    if (err.code === "YOUTUBE_DISABLED") {
      const cached = store.getVideo(id);
      if (cached) {
        return res.status(200).json({ source: "YouTube cache", video: cached, scoring: scoring.analyseVideo(cached) });
      }
    }
    res.status(502).json({ error: err.message });
  }
};