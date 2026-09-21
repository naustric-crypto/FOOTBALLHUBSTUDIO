// api/leagues.js
const { apiFootball } = require("../lib/apiFootball");
const { HOUR } = require("../lib/cache");

module.exports = async (req, res) => {
  try {
    const search = req.query.search || "";
    const params = search ? { search } : { current: "true" };
    const data = await apiFootball("/leagues", params, 24 * HOUR);
    res.status(200).json({ response: data.response });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
