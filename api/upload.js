// api/upload.js
// Authorized-footage upload + rights workflow.
//
// GET  -> upload capability + existing assets
// POST -> either request a presigned PUT URL (action=presign) or register
//         an uploaded asset (action=register) with an explicit media status,
//         or confirm rights (action=confirm_rights).
//
// Rights gate: derived media cannot be published until rights_confirmed.
const storage = require("../services/storage");
const { MEDIA_STATUS } = require("../lib/config");

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  const body = req.body || {};

  try {
    if (method === "GET") {
      return res.status(200).json({
        upload_enabled: storage.enabled(),
        media_statuses: Object.values(MEDIA_STATUS),
        assets: storage.listAssets(50),
      });
    }

    const action = body.action || "register";

    if (action === "presign") {
      const url = storage.presignPut(body.key, body.expires);
      if (!url) {
        return res.status(200).json({
          ok: false,
          upload_enabled: false,
          reason:
            "Storage not configured (STORAGE_ENDPOINT / STORAGE_BUCKET / keys). Upload UI disabled.",
        });
      }
      return res.status(200).json({ ok: true, upload_url: url });
    }

    if (action === "confirm_rights") {
      const asset = storage.confirmRights(body.assetId, body.confirmed !== false);
      return res.status(asset ? 200 : 404).json({ ok: Boolean(asset), asset });
    }

    // register
    const asset = storage.registerAsset({
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
      mediaStatus: body.mediaStatus || MEDIA_STATUS.UNKNOWN,
      uploadedBy: body.uploadedBy || "admin",
      url: body.url || null,
    });
    res.status(200).json({
      ok: true,
      asset,
      // Reminder surfaced to the UI.
      notice:
        "Rights must be confirmed before publishing media derived from this footage.",
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};