# Football Hub — Vercel version

Homepage now has three always-visible sections (news, highlights) plus a
league explorer (search or quick-pick chips → standings/fixtures/predictions),
instead of everything hidden behind tabs.

## Full file layout
```
/api/leagues.js
/api/standings.js
/api/fixtures.js
/api/predictions.js
/api/odds.js
/api/highlights.js
/api/news.js
/lib/cache.js
/lib/apiFootball.js
/public/index.html
/public/style.css
/public/app.js
package.json
```
`index.html`/`style.css`/`app.js` must be inside `public/` — Vercel serves
that folder's contents at the site root automatically. If they sit loose at
the repo root instead, Vercel may try to run `app.js` as a serverless
function (it'll crash immediately with `document is not defined`, since
that file expects a browser, not Node).

## Environment variables (Vercel > Project > Settings > Environment Variables)
- `API_FOOTBALL_KEY` — from https://dashboard.api-football.com (free)
- `NEWS_API_KEY` — from https://newsapi.org/register (free)
  - Free tier: 100 requests/day, headlines run ~24h behind real-time, terms
    say development/testing use — fine for a personal project, but know
    that if this ever needs to be a "real" commercial product, you'd
    outgrow this tier's terms of service too, not just its rate limit.

Check both boxes for Production (and Preview, if you want preview
deployments to work too). Redeploy after adding/changing env vars —
existing deployments don't pick them up retroactively.

## Why highlights looked stale before
The free Scorebat feed doesn't guarantee newest-first ordering. `api/highlights.js`
now sorts every response by match date before caching it, and the cache TTL
was shortened from 30 to 15 minutes. That said, this is still a free,
unauthenticated feed covering a limited set of competitions — if a specific
match's highlight isn't showing up, it may simply not be in Scorebat's free
feed yet (or at all). Getting a free registered Scorebat token
(scorebat.com/video-api/) gives broader, faster coverage if you outgrow this.

## Quick-pick league IDs
The homepage chips (Premier League, La Liga, Serie A, Bundesliga, Ligue 1,
Champions League) use commonly-cited API-Football league IDs (39, 140, 135,
78, 61, 2). These are widely used and should be stable, but if a chip ever
loads the wrong league, search for it by name instead — the search path
always resolves IDs live from the API rather than relying on a hardcoded number.
