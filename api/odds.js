// api/odds.js
const { apiFootball } = require("../lib/apiFootball");
const { HOUR } = require("../lib/cache");

module.exports = async (req, res) => {
  const { fixture } = req.query;
  if (!fixture) return res.status(400).json({ error: "fixture id is required" });
  try {
    const data = await apiFootball("/odds", { fixture }, 6 * HOUR);
    res.status(200).json({ response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
