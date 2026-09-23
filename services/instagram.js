// services/instagram.js
//
// Instagram publishing adapter (Graph API).
//
// Publishing is NEVER automatic. This module only prepares and, when an
// explicit admin approval is present, pushes a container. Every generated
// item carries a UTM-tagged FootballHub CTA built from lib/config.utmUrl.
//
// Without INSTAGRAM_* credentials this module still generates the full
// package; it simply reports that the live publish step is unavailable.

const { instagram, utmUrl } = require("../lib/config");
const store = require("../lib/store");

const GRAPH = "https://graph.facebook.com/v21.0";

function enabled() {
  return Boolean(instagram.accessToken && instagram.businessAccountId);
}

function configured() {
  return instagram.enabled;
}

function utmFor(slug) {
  return utmUrl(slug, "instagram", "social", "match_analysis");
}

// Build the complete publish-ready Instagram package from generated social
// content. We keep the raw content and add the CTA + tracking URL.
function buildPackage({ content, slug, match }) {
  const url = utmFor(slug);
  const reel = content?.reel || {};
  return {
    kind: "instagram_reel",
    slug,
    match_id: match?.id || null,
    hook: reel.hook || "",
    script: reel.script || "",
    narration: reel.narration || "",
    on_screen_text: reel.on_screen_text || [],
    caption: reel.caption || "",
    hashtags: reel.hashtags || [],
    cta: reel.cta || `Full breakdown on FootballHub: ${url}`,
    tracking_url: url,
    // Instagram Reels are 30-90s per the brief.
    target_duration_seconds: { min: 30, max: 90 },
    status: "READY_FOR_REVIEW",
  };
}

// Create a media container. Requires an explicit approved flag, enforcing
// the "no automatic publication" rule end to end.
async function createContainer({ package: pkg, videoUrl, approved }) {
  if (!approved) {
    return { ok: false, reason: "Blocked: admin approval is required before publishing." };
  }
  if (!enabled()) {
    return {
      ok: false,
      reason:
        "Instagram publishing not configured (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID).",
      package: pkg,
    };
  }
  try {
    const body = new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption: `${pkg.caption}\n\n${pkg.cta}\n${(pkg.hashtags || []).join(" ")}`,
      access_token: instagram.accessToken,
    });
    const res = await fetch(`${GRAPH}/${instagram.businessAccountId}/media`, {
      method: "POST",
      body,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `Instagram ${res.status}`);
    return { ok: true, container_id: json.id };
  } catch (err) {
    store.recordError("instagram", err.message);
    return { ok: false, reason: err.message };
  }
}

function status() {
  return {
    configured: configured(),
    publish_enabled: enabled(),
    connected: enabled(),
  };
}

module.exports = {
  enabled,
  configured,
  utmFor,
  buildPackage,
  createContainer,
  status,
};