// api/match/confirm.js
// Admin confirms or corrects a proposed match.
const studio = require("../../lib/studio");

module.exports = async (req, res) => {
  const body = req.body || {};
  const q = req.query || {};
  const matchId = body.matchId || q.matchId;
  if (!matchId) return res.status(400).json({ error: "matchId required" });

  const overrides = {
    home_team: body.home_team,
    away_team: body.away_team,
    competition: body.competition,
    match_date: body.match_date,
    score: body.score,
    venue: body.venue,
  };
  // Strip undefined so we only override supplied fields.
  Object.keys(overrides).forEach((k) => overrides[k] === undefined && delete overrides[k]);

  try {
    const result = await studio.confirmMatch(matchId, overrides);
    res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
};