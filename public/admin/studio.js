// public/admin/studio.js — shared client helpers for Analyst Studio.
(function () {
  const API = {
    dashboard: "/api/dashboard",
    latest: "/api/youtube/latest",
    search: "/api/youtube/search",
    video: (id) => "/api/youtube/videos/" + encodeURIComponent(id),
    channel: (id) => "/api/youtube/channels/" + encodeURIComponent(id),
    identify: "/api/match/identify",
    confirmMatch: "/api/match/confirm",
    analysisNew: "/api/analysis/new",
    analysis: (id) => "/api/analysis/" + encodeURIComponent(id),
    analysisBySlug: (slug) => "/api/analysis/x?slug=" + encodeURIComponent(slug),
    contentGen: "/api/content/generate",
    content: "/api/content",
    pipeline: "/api/pipeline",
    analytics: "/api/analytics",
    upload: "/api/upload",
  };

  async function get(url) {
    const r = await fetch(url);
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("json")) throw new Error("Non-JSON response (" + r.status + ")");
    return r.json();
  }

  async function post(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  }

  const ENT = { "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return "&" + ENT[c] + ";";
    });
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function fmtNum(n) {
    if (n == null) return "\u2014";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }

  function fmtDuration(sec) {
    if (!sec) return "\u2014";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function pct(x) {
    if (x == null) return "\u2014";
    return Math.round(x * 100) + "%";
  }

  function confBadge(c) {
    const cls = c >= 0.8 ? "ok" : c >= 0.5 ? "warn" : "bad";
    return '<span class="badge ' + cls + '">' + pct(c) + "</span>";
  }

  function categoryBadge(cat) {
    const label = (cat || "OTHER").replace(/_/g, " ");
    const cls = cat === "MATCH_HIGHLIGHT" ? "yt" : cat === "FOOTBALL_NEWS" ? "fh" : "";
    return '<span class="badge ' + cls + '">' + esc(label) + "</span>";
  }

  function sourceBadge(src) {
    const map = { "YouTube": "yt", "Football API": "ok", "Both": "fh", "Manual": "warn" };
    return '<span class="badge ' + (map[src] || "") + '">' + esc(src || "YouTube") + "</span>";
  }

  function nav(active) {
    const items = [
      ["/admin", "Dashboard", "dashboard"],
      ["/admin/youtube", "Latest Football", "youtube"],
      ["/admin/youtube/search", "Search", "search"],
      ["/admin/analysis/new", "New Analysis", "analysis"],
    ];
    const header = el("header", { class: "top" });
    header.innerHTML =
      '<div class="brand">FootballHub <span>Analyst Studio</span></div>' +
      '<nav class="top">' +
      items
        .map(
          (it) =>
            '<a href="' + it[0] + '" class="' + (it[2] === active ? "active" : "") + '">' +
            it[1] + "</a>"
        )
        .join("") +
      '<a href="/" target="_blank" rel="noopener">FootballHub \u2197</a>' +
      "</nav>";
    return header;
  }

  function mount(active) {
    document.body.prepend(nav(active));
  }

  function videoCard(v) {
    const a = el("a", { href: "/admin/youtube/videos/" + v.youtube_video_id, class: "card" });
    a.innerHTML =
      '<img class="thumb" loading="lazy" src="' + esc(v.thumbnail || "") + '" alt="">' +
      "<h4>" + esc(v.title) + "</h4>" +
      '<div class="meta">' + esc(v.channel_title || "") + " \u00b7 " + fmtDate(v.published_at) + "</div>" +
      '<div class="row">' + categoryBadge(v.category) +
      (v.duration_seconds ? '<span class="pill">' + fmtDuration(v.duration_seconds) + "</span>" : "") +
      (v.view_count != null ? '<span class="pill">' + fmtNum(v.view_count) + " views</span>" : "") +
      '<span class="badge yt">YouTube</span></div>';
    return a;
  }

  function loading(target) {
    target.innerHTML = '<div class="loading">Loading\u2026</div>';
  }

  function errorBox(target, msg) {
    target.innerHTML = '<div class="error">' + esc(msg) + "</div>";
  }

  window.Studio = {
    API, get, post, el, esc, fmtDate, fmtNum, fmtDuration, pct,
    confBadge, categoryBadge, sourceBadge, nav, mount, videoCard, loading, errorBox,
  };
})();