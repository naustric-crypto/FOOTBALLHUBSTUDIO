// api/highlights.js
const { getCached, setCached, MINUTE } = require("../lib/cache");

module.exports = async (req, res) => {
  try {
    const cached = getCached("highlights");
    if (cached) return res.status(200).json({ response: cached });

    const r = await fetch("https://www.scorebat.com/video-api/v1/");
    if (!r.ok) throw new Error(`Scorebat feed failed: ${r.status}`);
    const json = await r.json();
    const list = Array.isArray(json) ? json : json.response || [];

    // The free feed isn't guaranteed to arrive newest-first, so sort it
    // ourselves by match date/time, most recent first.
    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Shorter cache than the API-Football routes: this feed is free and
    // needs no key, so there's no quota reason to hold it longer, and
    // shorter caching means new highlights show up sooner.
    setCached("highlights", sorted, 15 * MINUTE);
    res.status(200).json({ response: sorted });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
