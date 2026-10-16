(() => {
    "use strict";

    const sprintSpeed2026 = Array.isArray(window.ABILITIES_SPRINT_SPEED_2026)
        ? window.ABILITIES_SPRINT_SPEED_2026
        : [];
    const exitVelocity2026 = Array.isArray(window.ABILITIES_EXIT_VELOCITY_2026)
        ? window.ABILITIES_EXIT_VELOCITY_2026
        : [];

    const PAGE_SIZE = 50;
    const POSITION_ORDER = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "TWP"];
    const state = { team: "", position: "", query: "", visibleCount: PAGE_SIZE };
    const exitState = {
        team: "",
        position: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "averageVelocity",
        sortDirection: "desc"
    };
    const feetPerSecondToKmh = (value) => value * 1.09728;
    const milesPerHourToKmh = (value) => value * 1.609344;
    const page = document.getElementById("abilities-page");
    const content = document.getElementById("abilities-content");

    const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const normalizeNameKey = (value) => String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();

    const japanesePlayerName = (name) => {
        try {
            return NHK_PLAYER_NAMES[normalizeNameKey(name)] || name;
        } catch (_error) {
            return name;
        }
    };

    const savantCustomUrl = (row, selections) =>
        `https://baseballsavant.mlb.com/leaderboard/custom?year=2026&type=batter&filter=${encodeURIComponent(row.player)}&sort=4&sortDir=desc&min=1&selections=${selections}&chart=false&x=pa&y=pa&r=no`;
    const savantRunningUrl = (row) => savantCustomUrl(row, "pa,sprint_speed,hp_to_1b");
    const savantExitVelocityUrl = (row) =>
        `https://baseballsavant.mlb.com/savant-player/${row.playerId}?stats=statcast-r-hitting-mlb`;

    const sortedPositions = (rows) => [...new Set(rows.map((row) => row.position))].sort((a, b) => {
        const aIndex = POSITION_ORDER.indexOf(a);
        const bIndex = POSITION_ORDER.indexOf(b);
        if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    const filteredRows = () => sprintSpeed2026.filter((row) => {
        if (state.team && row.team !== state.team) return false;
        if (state.position && row.position !== state.position) return false;
        if (state.query && !`${row.player} ${japanesePlayerName(row.player)} ${row.team}`.toLowerCase().includes(state.query)) return false;
        return true;
    });

    const renderTable = () => {
        const tbody = content?.querySelector("#sprint-speed-body");
        if (!tbody) return;
        const rows = filteredRows();
        const visibleRows = rows.slice(0, state.visibleCount);
        tbody.innerHTML = rows.length ? visibleRows.map((row) => {
            const rank = sprintSpeed2026.indexOf(row) + 1;
            const width = Math.max(0, Math.min(100, ((row.speed - 23) / 7.5) * 100));
            const runningUrl = savantRunningUrl(row);
            const infieldHitUrl = savantCustomUrl(row, "pa,hits,infield_hits");
            const stolenBaseUrl = savantCustomUrl(row, "pa,stolen_bases,caught_stealing");
            return `<tr>
                <td class="ability-rank">${rank}</td>
                <td class="ability-team">${row.teamId
                    ? `<img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy">`
                    : "—"}</td>
                <td class="ability-player">${escapeHtml(japanesePlayerName(row.player))}</td>
                <td>${row.age}</td>
                <td>${row.throwBat}</td>
                <td>${escapeHtml(row.position)}</td>
                <td>${row.hp1b === null ? "—" : `<a class="ability-value-link" href="${runningUrl}" target="_blank" rel="noopener noreferrer">${row.hp1b.toFixed(2)}秒</a>`}</td>
                <td><a class="ability-value-link" href="${infieldHitUrl}" target="_blank" rel="noopener noreferrer">${row.infieldHits === null ? "—" : row.infieldHits}/${row.hits}</a></td>
                <td><a class="ability-value-link" href="${stolenBaseUrl}" target="_blank" rel="noopener noreferrer">${row.stolenBases}/${row.stolenBaseAttempts}</a></td>
                <td class="ability-speed"><a class="ability-value-link" href="${runningUrl}" target="_blank" rel="noopener noreferrer"><span class="ability-speed-bar"><i style="width:${width.toFixed(1)}%"></i></span>${feetPerSecondToKmh(row.speed).toFixed(1)}</a></td>
            </tr>`;
        }).join("") : `<tr><td colspan="10">条件に一致する選手はいません。</td></tr>`;

        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}人を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderSprintSpeed = () => {
        if (!content) return;
        const teams = [...new Set(sprintSpeed2026.map((row) => row.team))].sort();
        const positions = sortedPositions(sprintSpeed2026);
        content.innerHTML = `
            <section class="ability-hero">
                <div>
                    <h3>野手｜スプリントスピード</h3>
                </div>
                <div class="ability-scale" aria-label="速度の目安">
                    <div><strong>${feetPerSecondToKmh(27).toFixed(1)}</strong><span>MLB平均 km/h</span></div>
                </div>
            </section>
            <div class="ability-controls">
                <select id="ability-position" aria-label="守備位置">
                    <option value="">全ポジション</option>
                    ${positions.map((value) => `<option value="${value}">${value}</option>`).join("")}
                </select>
                <select id="ability-team" aria-label="チーム">
                    <option value="">全チーム</option>
                    ${teams.map((value) => `<option value="${value}">${value}</option>`).join("")}
                </select>
                <input id="ability-search" type="search" placeholder="選手名・チームで検索" aria-label="選手検索">
            </div>
            <div class="ability-table-wrap">
                <table class="ability-table">
                    <thead><tr><th>順位</th><th>TEAM</th><th>選手</th><th>年齢</th><th>投/打</th><th>守備</th><th>本塁→１塁</th><th>内野安打<br><small>実数/安打数</small></th><th>盗塁<br><small>成功数/企図数</small></th><th>SPRINT SPEED km/h</th></tr></thead>
                    <tbody id="sprint-speed-body"></tbody>
                </table>
            </div>
            <div class="ability-table-footer">
                <span id="ability-result-summary"></span>
                <button type="button" id="ability-show-more">さらに50人表示</button>
            </div>
            <p class="ability-table-note">2026年レギュラーシーズン／投手を除く／スプリントスピード記録あり。走塁速度はBaseball Savant、選手情報はMLB公式、内野安打は取得済みのFanGraphsデータを参照（2026年10月16日時点）。</p>`;

        const resetVisibleCount = () => {
            state.visibleCount = PAGE_SIZE;
        };

        content.querySelector("#ability-position")?.addEventListener("change", (event) => {
            state.position = event.target.value;
            resetVisibleCount();
            renderTable();
        });
        content.querySelector("#ability-team")?.addEventListener("change", (event) => {
            state.team = event.target.value;
            resetVisibleCount();
            renderTable();
        });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => {
            state.query = event.target.value.trim().toLowerCase();
            resetVisibleCount();
            renderTable();
        });
        content.querySelector("#ability-show-more")?.addEventListener("click", () => {
            state.visibleCount += PAGE_SIZE;
            renderTable();
        });
        renderTable();
    };

    const filteredExitVelocityRows = () => exitVelocity2026.filter((row) => {
        if (exitState.team && row.team !== exitState.team) return false;
        if (exitState.position && row.position !== exitState.position) return false;
        if (exitState.query && !`${row.player} ${japanesePlayerName(row.player)} ${row.team}`.toLowerCase().includes(exitState.query)) return false;
        return true;
    });

    const sortedExitVelocityRows = () => filteredExitVelocityRows().sort((a, b) => {
        const direction = exitState.sortDirection === "asc" ? 1 : -1;
        const difference = (a[exitState.sortKey] - b[exitState.sortKey]) * direction;
        return difference || a.player.localeCompare(b.player);
    });

    const renderExitVelocityTable = () => {
        const tbody = content?.querySelector("#exit-velocity-body");
        if (!tbody) return;
        const rows = sortedExitVelocityRows();
        const visibleRows = rows.slice(0, exitState.visibleCount);
        tbody.innerHTML = rows.length ? visibleRows.map((row, index) => {
            const playerUrl = savantExitVelocityUrl(row);
            const valueLink = (value) => `<a class="ability-value-link" href="${playerUrl}" target="_blank" rel="noopener noreferrer">${value}</a>`;
            return `<tr>
                <td class="ability-rank">${index + 1}</td>
                <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy"></td>
                <td class="ability-player">${escapeHtml(japanesePlayerName(row.player))}</td>
                <td>${row.age}</td>
                <td>${row.throwBat}</td>
                <td>${escapeHtml(row.position)}</td>
                <td class="ability-velocity">${valueLink(`${milesPerHourToKmh(row.averageVelocity).toFixed(1)} km/h`)}</td>
                <td class="ability-velocity">${valueLink(`${milesPerHourToKmh(row.maxVelocity).toFixed(1)} km/h`)}</td>
                <td>${valueLink(`${row.hardHitPercent.toFixed(1)}%`)}</td>
                <td>${valueLink(row.hardHitCount)}</td>
                <td>${valueLink(`${row.barrelPercent.toFixed(1)}%`)}</td>
                <td>${valueLink(row.barrelCount)}</td>
            </tr>`;
        }).join("") : `<tr><td colspan="12">条件に一致する選手はいません。</td></tr>`;

        content.querySelectorAll("[data-exit-sort]").forEach((button) => {
            const active = button.dataset.exitSort === exitState.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? exitState.sortDirection : "";
            button.setAttribute("aria-sort", active
                ? (exitState.sortDirection === "desc" ? "descending" : "ascending")
                : "none");
        });
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}人を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderExitVelocity = () => {
        if (!content) return;
        const teams = [...new Set(exitVelocity2026.map((row) => row.team))].sort();
        const positions = sortedPositions(exitVelocity2026);
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-exit-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
        content.innerHTML = `
            <section class="ability-hero">
                <div><h3>野手｜打球速度</h3></div>
                <div class="ability-scale" aria-label="速度の目安">
                    <div><strong>${milesPerHourToKmh(window.ABILITIES_EXIT_VELOCITY_MLB_AVG_2026).toFixed(1)}</strong><span>MLB平均 km/h</span></div>
                </div>
            </section>
            <div class="ability-controls">
                <select id="ability-position" aria-label="守備位置">
                    <option value="">全ポジション</option>
                    ${positions.map((value) => `<option value="${value}">${value}</option>`).join("")}
                </select>
                <select id="ability-team" aria-label="チーム">
                    <option value="">全チーム</option>
                    ${teams.map((value) => `<option value="${value}">${value}</option>`).join("")}
                </select>
                <input id="ability-search" type="search" placeholder="選手名・チームで検索" aria-label="選手検索">
            </div>
            <div class="ability-table-wrap">
                <table class="ability-table exit-velocity-table">
                    <thead><tr><th>順位</th><th>TEAM</th><th>選手</th><th>年齢</th><th>投/打</th><th>守備</th><th>${sortHeader("平均速度", "averageVelocity")}</th><th>${sortHeader("最速速度", "maxVelocity")}</th><th>${sortHeader("ハードヒット率", "hardHitPercent")}</th><th>${sortHeader("ハードヒット数", "hardHitCount")}</th><th>${sortHeader("バレル率", "barrelPercent")}</th><th>${sortHeader("バレル数", "barrelCount")}</th></tr></thead>
                    <tbody id="exit-velocity-body"></tbody>
                </table>
            </div>
            <div class="ability-table-footer">
                <span id="ability-result-summary"></span>
                <button type="button" id="ability-show-more">さらに50人表示</button>
            </div>
            <p class="ability-table-note">2026年レギュラーシーズン／投手を除く／計測打球1球以上。速度はすべてkm/h表示。Baseball Savant・MLB公式を参照（2026年10月16日時点）。</p>`;

        const resetVisibleCount = () => { exitState.visibleCount = PAGE_SIZE; };
        content.querySelector("#ability-position")?.addEventListener("change", (event) => {
            exitState.position = event.target.value;
            resetVisibleCount();
            renderExitVelocityTable();
        });
        content.querySelector("#ability-team")?.addEventListener("change", (event) => {
            exitState.team = event.target.value;
            resetVisibleCount();
            renderExitVelocityTable();
        });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => {
            exitState.query = event.target.value.trim().toLowerCase();
            resetVisibleCount();
            renderExitVelocityTable();
        });
        content.querySelectorAll("[data-exit-sort]").forEach((button) => button.addEventListener("click", () => {
            const key = button.dataset.exitSort;
            if (exitState.sortKey === key) {
                exitState.sortDirection = exitState.sortDirection === "desc" ? "asc" : "desc";
            } else {
                exitState.sortKey = key;
                exitState.sortDirection = "desc";
            }
            resetVisibleCount();
            renderExitVelocityTable();
        }));
        content.querySelector("#ability-show-more")?.addEventListener("click", () => {
            exitState.visibleCount += PAGE_SIZE;
            renderExitVelocityTable();
        });
        renderExitVelocityTable();
    };

    const showAbility = (ability) => {
        page?.querySelectorAll("[data-ability]").forEach((button) => {
            button.classList.toggle("active", button.dataset.ability === ability);
        });
        if (ability === "exit-velocity") {
            renderExitVelocity();
            return;
        }
        renderSprintSpeed();
    };

    page?.querySelectorAll("[data-ability]").forEach((button) => {
        button.addEventListener("click", () => showAbility(button.dataset.ability));
    });

    window.Abilities = {
        open() {
            if (!page) return;
            page.hidden = false;
            showAbility("sprint-speed");
        },
        close() {
            if (page) page.hidden = true;
        }
    };
})();
