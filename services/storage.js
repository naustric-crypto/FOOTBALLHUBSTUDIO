// services/storage.js
//
// Storage for administrator-uploaded (authorized) footage and derived media.
//
// Uses S3-compatible presigned uploads when STORAGE_* variables are
// configured. If they are not, uploads are disabled and the UI shows a
// clear notice — we never silently pretend an upload succeeded.
//
// This is deliberately separate from the YouTube flow: the only footage we
// ever store and process is footage the administrator has the right to use.

const crypto = require("crypto");
const { storage, MEDIA_STATUS } = require("../lib/config");
const store = require("../lib/store");

function enabled() {
  return storage.enabled;
}

function memAssets() {
  return (
    globalThis.__footballHubAssets ||
    (globalThis.__footballHubAssets = new Map())
  );
}

// Record an uploaded asset. `media_status` must be an explicit rights
// declaration; we default to UNKNOWN (which blocks processing).
function registerAsset({
  filename,
  contentType,
  size,
  mediaStatus = MEDIA_STATUS.UNKNOWN,
  uploadedBy = "admin",
  url = null,
}) {
  const status = Object.values(MEDIA_STATUS).includes(mediaStatus)
    ? mediaStatus
    : MEDIA_STATUS.UNKNOWN;
  const asset = {
    id: store.id("asset"),
    filename,
    content_type: contentType,
    size,
    media_status: status,
    uploaded_by: uploadedBy,
    url,
    uploaded_at: store.nowIso(),
    // Rights must be explicitly confirmed before publishing derived media.
    rights_confirmed: false,
  };
  memAssets().set(asset.id, asset);
  return asset;
}

function getAsset(id) {
  return memAssets().get(id) || null;
}

function listAssets(limit = 50) {
  return Array.from(memAssets().values())
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
    .slice(0, limit);
}

// Admin explicitly confirms they hold the rights to publish media derived
// from this asset. Until this is true, derived media must not be published.
function confirmRights(assetId, confirmed = true) {
  const asset = getAsset(assetId);
  if (!asset) return null;
  asset.rights_confirmed = Boolean(confirmed);
  asset.rights_confirmed_at = store.nowIso();
  return asset;
}

// --- Presigned S3 upload (optional) -----------------------------------------

// AWS SigV4 presign for a PUT. If anything is missing we return null and
// the caller disables the upload UI rather than erroring the whole page.
function presignPut(key, expiresSeconds = 900) {
  if (!enabled() || !storage.accessKey || !storage.secretKey) return null;
  try {
    const url = new URL(storage.endpoint);
    const host = url.host;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const credential = `${storage.accessKey}/${credentialScope}`;

    const canonicalUri = `/${storage.bucket}/${key}`;
    const params = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": "host",
    });
    const canonicalQuery = params.toString();

    const canonicalRequest = [
      "PUT",
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const signingKey = getSignatureKey(storage.secretKey, dateStamp);
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    return `${url.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  } catch (err) {
    store.recordError("storage", err.message);
    return null;
  }
}

function getSignatureKey(key, dateStamp) {
  const kDate = crypto.createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update("auto").digest();
  const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
  return crypto.createHmac("sha256", kService).update("aws4_request").digest();
}

module.exports = {
  enabled,
  registerAsset,
  getAsset,
  listAssets,
  confirmRights,
  presignPut,
};