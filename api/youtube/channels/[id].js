// api/youtube/channels/[id].js
// Efficient polling of a KNOWN channel's recent uploads via its uploads
// playlist (playlistItems API), not repeated search.list.
const studio = require("../../../lib/studio");
const { youtube } = require("../../../lib/config");

module.exports = async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "channel id required" });
  try {
    const result = await studio.discoverChannel(id, {
      maxResults: req.query?.maxResults,
    });
    res.status(200).json({
      source: "YouTube",
      channel_id: id,
      poll_seconds: youtube.poll.channelSeconds,
      response: result.items,
      nextPageToken: result.nextPageToken,
    });
  } catch (err) {
    res.status(502).json({ error: err.message, response: [] });
  }
};