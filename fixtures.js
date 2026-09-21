// api/fixtures.js
const { apiFootball } = require("../lib/apiFootball");
const { MINUTE } = require("../lib/cache");

module.exports = async (req, res) => {
  const { league, season, next } = req.query;
  if (!league || !season) {
    return res.status(400).json({ error: "league and season are required" });
  }
  try {
    const data = await apiFootball(
      "/fixtures",
      { league, season, next: next || "10" },
      30 * MINUTE
    );
    res.status(200).json({ response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
