const state = {
  league: null,
  season: new Date().getFullYear(),
};

// ---------- Tabs (Table / Fixtures) ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- Scoreboard quick-pick tabs ----------
document.querySelectorAll(".score-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".score-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    selectLeagueById({
      id: Number(tab.dataset.id),
      name: tab.dataset.name,
      country: tab.dataset.country,
    });
  });
});

// API-Football's free tier includes every league, but not every season has
// standings/fixtures data on that tier — the "current" season flag doesn't
// mean the free plan actually has data for it. Prefer the most recent
// season whose coverage says standings are included; only fall back to
// "current" if none of the seasons report that coverage.
function pickBestSeason(seasons) {
  const withStandings = seasons.filter((s) => s.coverage?.standings);
  if (withStandings.length) return withStandings[withStandings.length - 1];
  return seasons.find((s) => s.current) || seasons[seasons.length - 1];
}

async function selectLeagueById({ id, name, country }) {
  showCurrentLeague(name, country, state.season);
  try {
    const res = await fetch(`/api/leagues?search=${encodeURIComponent(name)}`);
    const json = await res.json();
    const match = (json.response || []).find((item) => item.league.id === id);
    const seasons = match?.seasons || [];
    const best = pickBestSeason(seasons);
    state.season = best ? best.year : state.season;
  } catch (err) {
    console.error("Season lookup failed, using default year:", err);
  }

  state.league = { id, name, country };
  showCurrentLeague(name, country, state.season);
  loadStandings();
  loadFixtures();
}

function showCurrentLeague(name, country, season) {
  document.getElementById("current-league").classList.remove("hidden");
  document.getElementById("league-name").textContent = name;
  document.getElementById("league-country").textContent = `${country}, ${season} season`;
}

// ---------- League search ----------
const searchInput = document.getElementById("league-search");
const resultsBox = document.getElementById("league-results");
let searchTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    resultsBox.classList.remove("open");
    return;
  }
  searchTimer = setTimeout(() => runLeagueSearch(q), 350);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".league-picker")) resultsBox.classList.remove("open");
});

async function runLeagueSearch(q) {
  try {
    const res = await fetch(`/api/leagues?search=${encodeURIComponent(q)}`);
    const json = await res.json();
    renderLeagueResults(json.response || []);
  } catch (err) {
    console.error(err);
  }
}

function renderLeagueResults(items) {
  resultsBox.innerHTML = "";
  if (!items.length) {
    resultsBox.classList.remove("open");
    return;
  }
  items.slice(0, 15).forEach((item) => {
    const div = document.createElement("div");
    div.className = "league-result-item";
    const logo = item.league.logo || "";
    div.innerHTML = `
      <img src="${logo}" alt="" onerror="this.style.visibility='hidden'"/>
      <span>${item.league.name}</span>
      <small>${item.country?.name || ""}</small>
    `;
    div.addEventListener("click", () => selectLeague(item));
    resultsBox.appendChild(div);
  });
  resultsBox.classList.add("open");
}

function selectLeague(item) {
  document.querySelectorAll(".score-tab").forEach((t) => t.classList.remove("active"));

  const seasons = item.seasons || [];
  const best = pickBestSeason(seasons);
  state.season = best ? best.year : state.season;

  state.league = {
    id: item.league.id,
    name: item.league.name,
    country: item.country?.name || "",
    logo: item.league.logo,
  };

  showCurrentLeague(state.league.name, state.league.country, state.season);

  resultsBox.classList.remove("open");
  searchInput.value = "";

  loadStandings();
  loadFixtures();
}

// ---------- Standings ----------
async function loadStandings() {
  const status = document.getElementById("standings-status");
  const table = document.getElementById("standings-table");
  status.textContent = "Loading table…";
  status.classList.remove("hidden");
  table.classList.add("hidden");

  try {
    const res = await fetch(
      `/api/standings?league=${state.league.id}&season=${state.season}`
    );
    const json = await res.json();
    const rows = json.response?.[0]?.league?.standings?.[0] || [];

    if (!rows.length) {
      status.textContent =
        `No table available for ${state.season} on your API plan. Try a bigger league or check its season coverage.`;
      return;
    }

    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.rank}</td>
        <td class="club"><img class="crest" src="${row.team.logo}" onerror="this.style.visibility='hidden'"/> ${row.team.name}</td>
        <td>${row.all.played}</td>
        <td>${row.all.win}</td>
        <td>${row.all.draw}</td>
        <td>${row.all.lose}</td>
        <td>${row.goalsDiff}</td>
        <td><strong>${row.points}</strong></td>
        <td>${row.form || "-"}</td>
      `;
      tbody.appendChild(tr);
    });

    status.classList.add("hidden");
    table.classList.remove("hidden");
  } catch (err) {
    status.textContent = "Couldn't load the table. Check the API-Football key in Vercel.";
    console.error(err);
  }
}

// ---------- Fixtures + predictions ----------
async function loadFixtures() {
  const status = document.getElementById("fixtures-status");
  const list = document.getElementById("fixtures-list");
  status.textContent = "Loading fixtures…";
  status.classList.remove("hidden");
  list.innerHTML = "";

  try {
    const res = await fetch(
      `/api/fixtures?league=${state.league.id}&season=${state.season}&next=8`
    );
    const json = await res.json();
    const fixtures = json.response || [];

    if (!fixtures.length) {
      status.textContent = "No upcoming fixtures found.";
      return;
    }
    status.classList.add("hidden");

    fixtures.forEach((f) => {
      const card = document.createElement("div");
      card.className = "fixture-card";
      const date = new Date(f.fixture.date);
      card.innerHTML = `
        <div class="fixture-teams">
          <span>${f.teams.home.name}</span>
          <span>vs</span>
          <span>${f.teams.away.name}</span>
        </div>
        <div class="fixture-meta">
          ${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          — ${f.league.round}
        </div>
        <button class="fixture-predict-btn">Show prediction</button>
        <div class="fixture-prediction"></div>
      `;
      const btn = card.querySelector(".fixture-predict-btn");
      const predictionBox = card.querySelector(".fixture-prediction");
      btn.addEventListener("click", () => loadPrediction(f.fixture.id, predictionBox, btn));
      list.appendChild(card);
    });
  } catch (err) {
    status.textContent = "Couldn't load fixtures.";
    console.error(err);
  }
}

async function loadPrediction(fixtureId, box, btn) {
  if (box.classList.contains("open")) {
    box.classList.remove("open");
    return;
  }
  btn.textContent = "Loading…";
  try {
    const res = await fetch(`/api/predictions?fixture=${fixtureId}`);
    const json = await res.json();
    const pred = json.response?.[0];

    if (!pred) {
      box.textContent = "No prediction available for this fixture yet.";
    } else {
      const winner = pred.predictions.winner?.name || "Too close to call";
      const advice = pred.predictions.advice || "";
      const pctHome = pred.predictions.percent?.home || "-";
      const pctDraw = pred.predictions.percent?.draw || "-";
      const pctAway = pred.predictions.percent?.away || "-";
      box.innerHTML = `
        Predicted result: <strong>${winner}</strong><br/>
        Win probability — Home ${pctHome} · Draw ${pctDraw} · Away ${pctAway}<br/>
        <em>${advice}</em>
      `;
    }
    box.classList.add("open");
    btn.textContent = "Hide prediction";
  } catch (err) {
    box.textContent = "Couldn't load a prediction right now.";
    box.classList.add("open");
    btn.textContent = "Show prediction";
    console.error(err);
  }
}

// ---------- News: one lead story + a headline list ----------
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function loadNews() {
  const status = document.getElementById("news-status");
  const layout = document.getElementById("news-layout");
  try {
    const res = await fetch("/api/news");
    const json = await res.json();
    const articles = json.response || [];

    if (!articles.length) {
      status.textContent = "No news available right now.";
      return;
    }
    status.classList.add("hidden");

    const [lead, ...rest] = articles;

    const leadEl = document.createElement("a");
    leadEl.className = "news-lead";
    leadEl.href = lead.url;
    leadEl.target = "_blank";
    leadEl.rel = "noopener";
    const leadImg = lead.urlToImage
      ? `<img src="${lead.urlToImage}" alt="" onerror="this.style.display='none'"/>`
      : "";
    leadEl.innerHTML = `
      ${leadImg}
      <h3>${lead.title || ""}</h3>
      <p class="dek">${lead.description || ""}</p>
      <span class="byline">${lead.source?.name || ""} — ${timeAgo(lead.publishedAt)}</span>
    `;

    const listEl = document.createElement("div");
    listEl.className = "news-list";
    rest.slice(0, 6).forEach((a) => {
      const row = document.createElement("a");
      row.className = "news-row";
      row.href = a.url;
      row.target = "_blank";
      row.rel = "noopener";
      row.innerHTML = `
        <h4>${a.title || ""}</h4>
        <span class="byline">${a.source?.name || ""} — ${timeAgo(a.publishedAt)}</span>
      `;
      listEl.appendChild(row);
    });

    layout.appendChild(leadEl);
    layout.appendChild(listEl);
  } catch (err) {
    status.textContent = "Couldn't load news right now.";
    console.error(err);
  }
}

// ---------- Highlights ----------
async function loadHighlights() {
  const status = document.getElementById("highlights-status");
  const grid = document.getElementById("highlights-grid");
  try {
    const res = await fetch("/api/highlights");
    const json = await res.json();
    const items = json.response || [];

    if (!items.length) {
      status.textContent = "No highlights available right now.";
      return;
    }
    status.classList.add("hidden");

    items.slice(0, 24).forEach((item) => {
      const card = document.createElement("div");
      card.className = "highlight-card";
      const embed = item.embed || `<a href="${item.matchviewUrl}" target="_blank">Watch</a>`;
      card.innerHTML = `
        <div class="embed">${embed}</div>
        <div class="meta">
          <strong>${item.title || ""}</strong>
          <span>${item.competition?.name || ""}</span>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    status.textContent = "Couldn't load highlights right now.";
    console.error(err);
  }
}

loadNews();
loadHighlights();
