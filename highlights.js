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
    setCached("highlights", list, 30 * MINUTE);
    res.status(200).json({ response: list });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
