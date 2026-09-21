# Football Hub

A zero-cost side project: search any of API-Football's 1,236 worldwide
leagues, view live standings, browse upcoming fixtures with win-probability
predictions, and watch recent goal highlights — all from free APIs.

## Stack
- **Backend:** Node.js + Express (`server.js`) — proxies the two APIs and
  caches every response in memory so you don't blow through free-tier limits.
- **Frontend:** plain HTML/CSS/JS (`public/`) — no build step, easy to host anywhere.
- **Data:**
  - [API-Football](https://www.api-football.com/) — leagues, standings, fixtures,
    predictions, odds. Free tier: **100 requests/day, 10/min**, but *every*
    endpoint and *all* leagues are included.
  - [Scorebat](https://www.scorebat.com/video-api/) — free goal/highlight
    embeds, no key required.

## Why the caching matters
100 requests/day sounds tiny, but this app is built so real visitors almost
never trigger a live API call:
- Standings are cached 1 hour, fixtures 30 min, predictions/odds 6 hours,
  league search 24 hours.
- The cache is shared across *all* visitors (it lives on the server, not the
  browser), so 100 requests/day can comfortably support a small personal
  audience. If you outgrow it, API-Football's paid tiers start at $19/mo for
  7,500 requests/day.

## Setup
1. `cd football-hub && npm install`
2. Get a free key at https://dashboard.api-football.com (email signup, no card).
3. Copy `.env.example` to `.env` and paste your key in.
4. `npm start` → open http://localhost:3000

## Deploying for free
Any of these work with zero cost, matching the same pattern as your other
static/low-cost projects:
- **Replit** — import the repo, set `API_FOOTBALL_KEY` in Secrets, run.
- **Render.com free web service** — connect the repo, set the env var, deploy.
- **Railway / Fly.io free tier** — similar.

Avoid deploying this as a purely static site (e.g. GitHub Pages) — it needs
the small Express server to hide your API key and do the caching. Calling
API-Football straight from browser JS would expose your key and burn through
the 100/day limit almost instantly with more than a couple of visitors.

## Extending it
- **News:** neither API used here provides articles. If you want a news feed
  next to standings, add a free tier of [NewsAPI.org](https://newsapi.org)
  or [GNews](https://gnews.io) and a `/api/news?q=<team>` route following the
  same caching pattern as the routes already in `server.js`.
- **More leagues by default:** `selectLeague()` in `app.js` currently only
  loads a league once you search and pick it. You could pre-load a shortlist
  (e.g. Premier League `39`, La Liga `140`, Serie A `135`, Bundesliga `78`,
  Ligue 1 `61`) as quick-pick buttons instead of requiring a search.
- **Predictions:** right now these are API-Football's own model
  (`/predictions`) and its bookmaker odds (`/odds`) — nothing is computed
  locally, matching what you asked for. If you later want your own model,
  the cached standings/fixtures data in this app is a reasonable starting
  dataset (form, home/away splits, goal difference).