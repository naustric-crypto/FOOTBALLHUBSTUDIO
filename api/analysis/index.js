// api/analysis/index.js
// List analyses (most recent first).
const store = require("../../lib/store");

module.exports = async (req, res) => {
  try {
    res.status(200).json({ response: store.listAnalyses(50) });
  } catch (err) {
    res.status(502).json({ error: err.message, response: [] });
  }
};