```javascript
// FootballHub frontend client code
// IMPORTANT: This file must run in the browser, NOT as a Vercel/Node server entry point.

(() => {
  "use strict";

  // Wait until the browser has loaded the HTML.
  document.addEventListener("DOMContentLoaded", () => {
    const state = {
      league: null,
      season: new Date().getFullYear(),
    };

    // ---------- Tabs ----------
    const tabButtons = document.querySelectorAll(".tab-btn");

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".tab-btn")
          .forEach((b) => b.classList.remove("active"));

        document
          .querySelectorAll(".tab-panel")
          .forEach((p) => p.classList.remove("active"));

        btn.classList.add("active");

        const panel = document.getElementById(`tab-${btn.dataset.tab}`);

        if (panel) {
          panel.classList.add("active");
        }
      });
    });

    // ---------- League search ----------
    const searchInput = document.getElementById("league-search");
    const resultsBox = document.getElementById("league-results");

    let searchTimer = null;

    if (searchInput && resultsBox) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);

        const q = searchInput.value.trim();

        if (q.length < 2) {
          resultsBox.classList.remove("open");
          return;
        }

        searchTimer = setTimeout(() => {
          runLeagueSearch(q);
        }, 350);
      });

      document.addEventListener("click", (e) => {
        const picker = e.target.closest(".league-picker");

        if (!picker) {
          resultsBox.classList.remove("open");
        }
      });
    }

    async function runLeagueSearch(q) {
      try {
        const res = await fetch(
          `/api/leagues?search=${encodeURIComponent(q)}`
        );

        if (!res.ok) {
          throw new Error(`League search failed: ${res.status}`);
        }

        const json = await res.json();

        renderLeagueResults(json.response || []);
      } catch (err) {
        console.error("League search error:", err);

        if (resultsBox) {
          resultsBox.classList.remove("open");
        }
      }
    }

    function renderLeagueResults(items) {
      if (!resultsBox) return;

      resultsBox.innerHTML = "";

      if (!items.length) {
        resultsBox.classList.remove("open");
        return;
      }

      items.slice(0, 15).forEach((item) => {
        const div = document.createElement("div");

        div.className = "league-result-item";

        const league = item.league || {};
        const country = item.country || {};

        const logo = league.logo || "";
        const name = league.name || "Unknown league";
        const countryName = country.name || "";

        div.innerHTML = `
          <img
            src="${escapeHtml(logo)}"
            alt=""
            onerror="this.style.visibility='hidden'"
          />
          <span>${escapeHtml(name)}</span>
          <small>${escapeHtml(countryName)}</small>
        `;

        div.addEventListener("click", () => {
          selectLeague(item);
        });

        resultsBox.appendChild(div);
      });

      resultsBox.classList.add("open");
    }

    function selectLeague(item) {
      const seasons = item.seasons || [];

      const current =
        seasons.find((s) => s.current) ||
        seasons[seasons.length - 1];

      state.season = current
        ? current.year
        : state.season;

      state.league = {
        id: item.league?.id,
        name: item.league?.name || "",
        country: item.country?.name || "",
        logo: item.league?.logo || "",
      };

      if (!state.league.id) {
        console.error("Invalid league:", item);
        return;
      }

      const currentLeague =
        document.getElementById("current-league");

      const leagueName =
        document.getElementById("league-name");

      const leagueCountry =
        document.getElementById("league-country");

      if (currentLeague) {
        currentLeague.classList.remove("hidden");
      }

      if (leagueName) {
        leagueName.textContent = state.league.name;
      }

      if (leagueCountry) {
        leagueCountry.textContent =
          `${state.league.country} · ${state.season}`;
      }

      if (resultsBox) {
        resultsBox.classList.remove("open");
      }

      if (searchInput) {
        searchInput.value = "";
      }

      loadStandings();
      loadFixtures();
    }

    // ---------- Standings ----------
    async function loadStandings() {
      if (!state.league) return;

      const status =
        document.getElementById("standings-status");

      const table =
        document.getElementById("standings-table");

      if (!status || !table) return;

      status.textContent = "Loading table…";
      status.classList.remove("hidden");
      table.classList.add("hidden");

      try {
        const res = await fetch(
          `/api/standings?league=${state.league.id}&season=${state.season}`
        );

        if (!res.ok) {
          throw new Error(`Standings request failed: ${res.status}`);
        }

        const json = await res.json();

        const rows =
          json.response?.[0]?.league?.standings?.[0] || [];

        if (!rows.length) {
          status.textContent =
            "No standings available for this league/season.";
          return;
        }

        const tbody = table.querySelector("tbody");

        if (!tbody) {
          throw new Error("Standings table body not found.");
        }

        tbody.innerHTML = "";

        rows.forEach((row) => {
          const tr = document.createElement("tr");

          const team = row.team || {};
          const all = row.all || {};

          tr.innerHTML = `
            <td>${escapeHtml(row.rank)}</td>

            <td class="club">
              <img
                class="crest"
                src="${escapeHtml(team.logo || "")}"
                alt=""
                onerror="this.style.visibility='hidden'"
              />
              ${escapeHtml(team.name || "")}
            </td>

            <td>${escapeHtml(all.played)}</td>
            <td>${escapeHtml(all.win)}</td>
            <td>${escapeHtml(all.draw)}</td>
            <td>${escapeHtml(all.lose)}</td>
            <td>${escapeHtml(row.goalsDiff)}</td>

            <td>
              <strong>${escapeHtml(row.points)}</strong>
            </td>

            <td>${escapeHtml(row.form || "-")}</td>
          `;

          tbody.appendChild(tr);
        });

        status.classList.add("hidden");
        table.classList.remove("hidden");
      } catch (err) {
        console.error("Standings error:", err);

        status.textContent =
          "Couldn't load standings. Check the server's API-Football key.";
      }
    }

    // ---------- Fixtures + predictions ----------
    async function loadFixtures() {
      if (!state.league) return;

      const status =
        document.getElementById("fixtures-status");

      const list =
        document.getElementById("fixtures-list");

      if (!status || !list) return;

      status.textContent = "Loading fixtures…";
      status.classList.remove("hidden");

      list.in
```
