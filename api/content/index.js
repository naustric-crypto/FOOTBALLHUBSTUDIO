// api/content/index.js
// List generated social content packages.
const store = require("../../lib/store");

module.exports = async (req, res) => {
  try {
    res.status(200).json({ response: store.listContent(50) });
  } catch (err) {
    res.status(502).json({ error: err.message, response: [] });
  }
};