// api/dashboard.js
// The main studio dashboard: latest videos, recent matches, new highlights,
// analyses in progress, content ready, Instagram/YouTube status, traffic,
// and API errors.
const store = require("../lib/store");
const youtubeService = require("../services/youtube");
const footballData = require("../services/football-data");
const instagram = require("../services/instagram");
const analytics = require("../services/analytics");
const ai = require("../services/ai");
const storage = require("../services/storage");
const { youtube, footballData: fdConfig } = require("../lib/config");

module.exports = async (req, res) => {
  try {
    const videos = store.listVideos(24);
    const matches = store.listMatches(12);
    const analyses = store.listAnalyses(50);
    const content = store.listContent(50);

    const inProgress = analyses.filter((a) => {
      const p = store.getPipeline(a.youtube_video_id);
      return p && p.stage === "ANALYSIS READY";
    });
    const contentReady = content.filter((c) => c.status === "READY_FOR_REVIEW");

    res.status(200).json({
      latest_videos: videos,
      recent_matches: matches,
      new_highlights: videos.filter((v) => v.category === "MATCH_HIGHLIGHT").slice(0, 12),
      analyses_in_progress: inProgress,
      content_ready: contentReady,
      instagram_status: instagram.status(),
      youtube_status: {
        configured: youtube.enabled,
        poll_latest_seconds: youtube.poll.latestSeconds,
        poll_channel_seconds: youtube.poll.channelSeconds,
      },
      football_data_status: { configured: fdConfig.enabled },
      ai_status: { configured: ai.enabled() },
      storage_status: { configured: storage.enabled() },
      footballhub_traffic: analytics.funnel(),
      api_errors: store.recentErrors(20),
      counts: {
        videos: store.listVideos(1000).length,
        matches: matches.length,
        analyses: analyses.length,
        content: content.length,
      },
      _services: {
        youtubeLoader: typeof youtubeService.search,
        footballDataLoader: typeof footballData.findMatch,
      },
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};