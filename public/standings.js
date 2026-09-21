// api/standings.js
const { apiFootball } = require("../lib/apiFootball");
const { HOUR } = require("../lib/cache");

module.exports = async (req, res) => {
  const { league, season } = req.query;
  if (!league || !season) {
    return res.status(400).json({ error: "league and season are required" });
  }
  try {
    const data = await apiFootball("/standings", { league, season }, HOUR);
    res.status(200).json({ response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
