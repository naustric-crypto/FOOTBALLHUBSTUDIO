// api/pipeline.js
// Content pipeline state + approve/publish transitions (manual only).
const store = require("../lib/store");
const studio = require("../lib/studio");
const { PIPELINE } = require("../lib/config");

module.exports = async (req, res) => {
  const body = req.body || {};
  const q = req.query || {};
  const method = (req.method || "GET").toUpperCase();

  try {
    if (method === "GET") {
      const stage = q.stage;
      const items = stage ? store.listPipelineByStage(stage) : store.listPipeline(100);
      return res.status(200).json({ stages: PIPELINE, response: items });
    }

    // POST transitions: approve / publish.
    const entityId = body.entityId;
    const action = body.action;
    if (!entityId || !action) {
      return res.status(400).json({ error: "entityId and action required" });
    }

    if (action === "approve") {
      const stage = await studio.approve(entityId, { approvedBy: body.approvedBy || "admin" });
      return res.status(200).json({ ok: true, stage });
    }
    if (action === "publish") {
      const result = await studio.publish(entityId, {
        approved: body.approved === true,
        approvedBy: body.approvedBy || "admin",
      });
      return res.status(result.ok ? 200 : 403).json(result);
    }
    res.status(400).json({ error: `unknown action ${action}` });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};