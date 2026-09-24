# FootballHub Analyst Studio — YouTube-first newsroom

The Analyst Studio makes **YouTube the primary discovery source** for fresh
football matches, highlights and news. The existing football-data API is
demoted to an **optional secondary source** and can no longer break anything.

The product behaves like a newsroom:

```
YOUTUBE (discover what just happened)
  → identify match
  → collect video metadata
  → identify teams
  → optionally enrich with football-data
  → generate AI analysis
  → generate social content
  → administrator approval
  → publish content
  → send viewers to FootballHub
```

> The existing FootballHub site is untouched. Every new file is **additive**:
> `api/youtube/*`, `api/match/*`, `api/analysis/*`, `api/content/*`,
> `api/pipeline.js`, `api/dashboard.js`, `api/upload.js`, `api/analytics.js`,
> `api/article/*`, the new `lib/*` modules, the new `services/*` modules and
> `public/admin/*` + `public/article.html`. `lib/config.js` and `services/*`
> keep the original `API_FOOTBALL_KEY` name working.

---

## Routes

### Admin (Analyst Studio)

| Route | Behaviour |
|---|---|
| `/admin` | Newsroom dashboard |
| `/admin/youtube` | **Latest Football** dashboard (competitions + teams) |
| `/admin/youtube/search` | Full search surface |
| `/admin/youtube/videos/:id` | Video page: embed player, match identification, Analyze/Save/Open on YouTube |
| `/admin/analysis/new` | New analysis + authorized-footage upload area |
| `/admin/analysis/:id` | Analysis: FACTS / OBSERVATIONS / INFERENCES, report, social content, pipeline |

### Public

| Route | Behaviour |
|---|---|
| `/analysis/:slug` | FootballHub article generated from the analysis |

The rewrites live in `vercel.json`. Existing routes (`/`, `/api/news`,
`/api/highlights`, `/api/standings`, …) are not referenced, so they keep working.

---

## API endpoints

**YouTube discovery**

```
GET /api/youtube/search?q=&publishedAfter=&publishedBefore=&order=date
                        &type=video&videoCategoryId=&language=&region=
                        &maxResults=&pageToken=
GET /api/youtube/latest
GET /api/youtube/videos/:id[?identify=1]
GET /api/youtube/channels/:id        # uploads-playlist polling
```

**Match identification**

```
POST /api/match/identify   { "videoId": "..." }
POST /api/match/confirm    { "matchId": "...", "home_team": "...", ... }
```

**Analysis / content / pipeline**

```
GET  /api/analysis                 # list
POST /api/analysis/new             { videoId, assetId?, notes? }
GET  /api/analysis/:id | ?slug=
POST /api/content/generate         { analysisId }
GET  /api/content
GET  /api/pipeline?stage=…
POST /api/pipeline                 { entityId, action: "approve" | "publish", approved: true }
GET  /api/dashboard
POST /api/analytics                # record landing_page_view
GET  /api/analytics                # summary + funnel
GET  /api/upload  |  POST /api/upload { action: "presign" | "register" | "confirm_rights" }
GET  /api/article?slug=
```

---

## YouTube content scoring

`lib/scoring.js` classifies every discovered video as one of:

```
MATCH_HIGHLIGHT · GOAL_COMPILATION · POST_MATCH_ANALYSIS · FOOTBALL_NEWS
PRESS_CONFERENCE · TRANSFER_NEWS · TACTICAL_ANALYSIS · OTHER
```

It also extracts candidate `home_team`, `away_team`, `competition`,
`match_date`, `score` from the title + description. **Every extracted field
carries a confidence value** and is never treated as a fact downstream — the
admin confirms or corrects it.

## Match identification

`lib/matchIdentify.js` runs three steps and tags the result with a source
indicator (`YouTube` · `Football API` · `Both` · `Manual`):

1. Structured football-data lookup **if available**.
2. AI-assisted identification **if structured data is unavailable**.
3. Always allow manual correction (the "Change Match" form).

## Media rights workflow

Every source has a media status:

```
EMBED_ONLY · OWNED · LICENSED · PERMISSION_GRANTED · PUBLIC_DOMAIN · UNKNOWN
```

Third-party YouTube highlights default to **EMBED_ONLY**. They are embedded
from YouTube and **never downloaded or republished**. Deeper (computer-vision)
analysis is only enabled for footage the administrator uploaded and marked
`OWNED` / `LICENSED` / `PERMISSION_GRANTED` / `PUBLIC_DOMAIN`, and the
administrator must confirm rights before derived media is published.

For EMBED_ONLY videos the analysis is generated from metadata, title,
description, available structured data, public facts and admin notes, and the
UI displays: *"Video-level tactical analysis requires authorized source footage."*

## Analysis output

FACTS, OBSERVATIONS and INFERENCES are kept strictly separate, and the report
includes: match summary, key moments, tactical analysis, team analysis, player
analysis, what decided the match, three important moments, the important
tactical adjustment and questions for further analysis. Inferences are never
presented as facts and statistics are never fabricated.

## Social funnel

Every generated item carries a UTM-tagged FootballHub URL:

```
?utm_source=instagram&utm_medium=social&utm_campaign=match_analysis&utm_content=[slug]
?utm_source=youtube&utm_medium=social&utm_campaign=match_analysis&utm_content=[slug]
?utm_source=facebook&utm_medium=social&utm_campaign=match_analysis&utm_content=[slug]
?utm_source=tiktok&utm_medium=social&utm_campaign=match_analysis&utm_content=[slug]
```

Packages are generated for all four platforms (Instagram Reel, YouTube
Short, Facebook Reel, TikTok). Instagram has a Graph API adapter; the other
three are copy-paste-ready packages the administrator posts manually.

`/analysis/:slug` records `landing_page_view` with `source`, `medium`,
`campaign`, `content` and `match_id`, and the dashboard shows the resulting
traffic.

## Content pipeline

```
DISCOVERED → MATCH IDENTIFIED → ANALYSIS READY → CONTENT GENERATED
           → ADMIN REVIEW → APPROVED → PUBLISHED
```

**No automatic publication.** `POST /api/pipeline` requires `approved: true`
before moving to `PUBLISHED`.

## API cost control

* Responses are cached (`lib/cache.js` + `lib/store.js` search cache).
* Videos are deduplicated by `youtube_video_id`.
* Known channels use `channels.list` → `playlistItems.list` (uploads playlist)
  instead of repeated `search.list`.
* Only the metadata fields that are rendered are requested.
* Polling intervals and cache TTLs are configuration-driven.

## Environment variables

See `.env.EXAMPLE`. At minimum set `YOUTUBE_API_KEY` to enable discovery.
Everything else degrades gracefully:

* no `FOOTBALL_API_KEY` → identification uses YouTube metadata (+ AI / manual);
* no `AI_API_KEY` → deterministic, evidence-only analysis/social fallback;
* no `STORAGE_*` → upload UI disabled with a clear notice;
* no `INSTAGRAM_*` → packages are produced, live publish is disabled.

## Quick start

```bash
# 1. copy env and set YOUTUBE_API_KEY
cp .env.EXAMPLE .env

# 2. (optional) run locally — Vercel CLI
vercel dev

# 3. open the studio
open http://localhost:3000/admin
```

Suggested first run: open `/admin/youtube` → click "Premier League highlights"
→ pick a video → **Identify Match** → **Analyze** → on the analysis page
**Generate social content** → **Approve** → **Publish to FootballHub**.