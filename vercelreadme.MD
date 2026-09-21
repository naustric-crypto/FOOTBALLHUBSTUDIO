# Football Hub — Vercel version

This is the same app as before, restructured for how Vercel actually runs
Node code: each backend route is its own small serverless function in
`/api`, instead of one long-running Express server.

## What changed from the Render/Express version
- `server.js` is gone — replaced by `api/leagues.js`, `api/standings.js`,
  `api/fixtures.js`, `api/predictions.js`, `api/odds.js`, `api/highlights.js`.
- `index.html`, `style.css`, `app.js` moved from `public/` to the repo root
  (Vercel serves root-level static files automatically; no config needed).
- No `express` or `dotenv` dependency anymore — Vercel injects environment
  variables directly, and each function is small enough not to need a
  framework.
- The in-memory cache (`lib/cache.js`) is now **best-effort**: it helps when
  the same warm serverless instance handles repeat requests, but unlike a
  persistent server it isn't a guaranteed shared cache across every visitor.
  Watch your API-Football usage; if you outgrow the free 100 requests/day,
  add Vercel KV or Upstash Redis (both have free tiers) as a real shared cache.

## Replacing the old repo contents
In your GitHub repo, delete: `server.js`, and the old root-level
`index.html`/`app.js`/`style.css` if you'd already moved them into `public/`
per earlier instructions (delete the `public/` folder too — not needed here).
Then add all the files from this project, keeping the same layout:
```
/api/leagues.js
/api/standings.js
/api/fixtures.js
/api/predictions.js
/api/odds.js
/api/highlights.js
/lib/cache.js
/lib/apiFootball.js
index.html
style.css
app.js
package.json
```

## Setting your API key on Vercel
Project > Settings > Environment Variables > add `API_FOOTBALL_KEY` with
your key, for the Production environment (and Preview too, if you want
preview deployments to work). Redeploy after adding it — existing
deployments don't pick up new env vars automatically.

## About that login wall you hit
The `...-ek7wxmyyo-flash-scarcity.vercel.app` link is a per-deployment
preview URL, which Vercel protects behind a login page by default. Once
this redeploys, use your stable Production URL instead (Vercel dashboard >
your project > Visit, or the domain shown under "Domains"). If that one
*also* shows a login wall, go to Project Settings > Deployment Protection
and set it so Production is publicly accessible.
