// netlify/functions/api.js
//
// Netlify adapter for the Vercel-style handlers that live in /api.
//
// On Vercel every file in /api is automatically exposed as a function at
// /api/<file> with a Node (req, res) contract. Netlify has no equivalent:
// functions must live in netlify/functions and export `handler(event)`.
// netlify.toml rewrites /api/* -> /.netlify/functions/api/:splat, and this
// dispatcher translates each request back into the (req, res) shape the
// existing handlers already implement, so /api/** source stays untouched.
//
// Verified against the current handlers: they only use req.method,
// req.query, req.body and the chainable res.status(...).json(...) pair.
// All requires below are string literals so Netlify's bundler (esbuild)
// inlines every handler — no dynamic require, no fs, no __dirname.

"use strict";

// Exact routes first (Vercel file mapping: /api/news -> api/news.js,
// /api/article -> api/article/index.js, /api/analysis/new -> api/analysis/new.js).
const STATIC_ROUTES = {
  "/analysis": () => require("../../api/analysis"),
  "/analysis/new": () => require("../../api/analysis/new"),
  "/analytics": () => require("../../api/analytics"),
  "/article": () => require("../../api/article"),
  "/content": () => require("../../api/content"),
  "/content/generate": () => require("../../api/content/generate"),
  "/dashboard": () => require("../../api/dashboard"),
  "/fixtures": () => require("../../api/fixtures"),
  "/highlights": () => require("../../api/highlights"),
  "/leagues": () => require("../../api/leagues"),
  "/match/confirm": () => require("../../api/match/confirm"),
  "/match/identify": () => require("../../api/match/identify"),
  "/news": () => require("../../api/news"),
  "/odds": () => require("../../api/odds"),
  "/pipeline": () => require("../../api/pipeline"),
  "/predictions": () => require("../../api/predictions"),
  "/standings": () => require("../../api/standings"),
  "/upload": () => require("../../api/upload"),
  "/youtube/latest": () => require("../../api/youtube/latest"),
  "/youtube/search": () => require("../../api/youtube/search"),
};

// Dynamic-segment routes ([id].js on Vercel). Checked only after the static
// map so /analysis/new always wins over /analysis/:id.
const DYNAMIC_ROUTES = [
  {
    pattern: /^\/analysis\/([^/]+)$/,
    names: ["id"],
    load: () => require("../../api/analysis/[id]"),
  },
  {
    pattern: /^\/youtube\/videos\/([^/]+)$/,
    names: ["id"],
    load: () => require("../../api/youtube/videos/[id]"),
  },
  {
    pattern: /^\/youtube\/channels\/([^/]+)$/,
    names: ["id"],
    load: () => require("../../api/youtube/channels/[id]"),
  },
];

// Normalise event.path to the route portion the handlers expect.
// Depending on how Netlify surfaces the rewrite, the path may arrive as the
// original (/api/news) or as the function path (/.netlify/functions/api/news).
function routePathOf(event) {
  let p = event.path || "/";
  p = p.split("?")[0];
  const fnPrefix = "/.netlify/functions/api";
  if (p === fnPrefix || p.indexOf(fnPrefix + "/") === 0) {
    p = p.slice(fnPrefix.length);
  } else if (p === "/api" || p.indexOf("/api/") === 0) {
    p = p.slice("/api".length);
  }
  p = p.replace(/\/+$/, ""); // "/news/" -> "/news"
  if (!p) p = "/";
  if (p[0] !== "/") p = "/" + p;
  return p;
}

// Minimal res implementation matching how the handlers actually respond.
function createResponse() {
  const state = {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    contentTypeExplicit: false,
    body: null,
  };
  const res = {
    status(code) {
      state.statusCode = code;
      return res;
    },
    setHeader(name, value) {
      const key = String(name).toLowerCase();
      if (key === "content-type") state.contentTypeExplicit = true;
      state.headers[key] = String(value);
      return res;
    },
    getHeader(name) {
      return state.headers[String(name).toLowerCase()];
    },
    json(payload) {
      if (!state.contentTypeExplicit) {
        state.headers["content-type"] = "application/json; charset=utf-8";
      }
      state.body = JSON.stringify(payload);
      return res;
    },
    send(payload) {
      if (typeof payload === "string" || Buffer.isBuffer(payload)) {
        state.body = payload.toString();
      } else {
        if (!state.contentTypeExplicit) {
          state.headers["content-type"] = "application/json; charset=utf-8";
        }
        state.body = JSON.stringify(payload);
      }
      return res;
    },
    end(payload) {
      if (payload !== undefined && payload !== null) {
        state.body = Buffer.isBuffer(payload)
          ? payload.toString("utf8")
          : String(payload);
      }
      return res;
    },
  };
  return { res, state };
}

function jsonResult(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

exports.handler = async (event) => {
  // netlify.toml rewrites /api/* here, but be tolerant of either path shape
  // and support direct hits on /.netlify/functions/api/<route> too.
  const route = routePathOf(event);
  const matched = resolve(route);

  if (!matched) {
    return jsonResult(404, { error: `No API route for ${route}` });
  }

  const query = Object.assign({}, event.queryStringParameters || {});
  Object.assign(query, matched.params);

  const req = {
    method: (event.httpMethod || "GET").toUpperCase(),
    query,
    body: parseBody(event),
    headers: event.headers || {},
    path: route,
    originalUrl: event.rawUrl || event.path || route,
  };

  // Warm the shared store once per instance (a no-op without Redis) so a
  // cold start sees analyses published by the other deployment.
  try {
    const store = require("../../lib/store");
    if (store.whenReady) await store.whenReady();
  } catch {
    /* store optional for routes that never touch it */
  }

  const { res, state } = createResponse();

  try {
    const handler = matched.load();
    await handler(req, res);
  } catch (err) {
    // Only synthesise an error response if the handler never replied.
    if (state.body === null) {
      state.statusCode = 500;
      state.headers["content-type"] = "application/json; charset=utf-8";
      state.body = JSON.stringify({
        error: (err && err.message) || "Internal Server Error",
      });
    }
  }

  // Browser-side caching: successful GETs are safe to reuse briefly (the
  // handlers already hold upstream data in their own 15-60 min server
  // cache), so repeat page views hit the browser cache with zero network.
  // Any other GET response must never be reused.
  if (req.method === "GET" && !state.headers["cache-control"]) {
    state.headers["cache-control"] =
      state.statusCode === 200
        ? "public, max-age=60, stale-while-revalidate=300"
        : "no-store";
  }

  return {
    statusCode: state.statusCode || 200,
    headers: state.headers,
    body: state.body === null ? "" : state.body,
    isBase64Encoded: false,
  };
};

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolve(route) {
  const staticLoad = STATIC_ROUTES[route];
  if (staticLoad) return { load: staticLoad, params: {} };

  for (const entry of DYNAMIC_ROUTES) {
    const m = route.match(entry.pattern);
    if (m) {
      const params = {};
      entry.names.forEach((name, i) => {
        params[name] = safeDecode(m[i + 1]);
      });
      return { load: entry.load, params };
    }
  }
  return null;
}

// Vercel parses JSON bodies automatically; Netlify hands them over as a
// (possibly base64-encoded) string. Mirror that behaviour.
function parseBody(event) {
  let body = event.body;
  if (body === null || body === undefined || body === "") return undefined;
  if (event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
