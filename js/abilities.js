(() => {
    "use strict";

    const sprintSpeed2026 = Array.isArray(window.ABILITIES_SPRINT_SPEED_2026)
        ? window.ABILITIES_SPRINT_SPEED_2026
        : [];
    const exitVelocity2026 = Array.isArray(window.ABILITIES_EXIT_VELOCITY_2026)
        ? window.ABILITIES_EXIT_VELOCITY_2026
        : [];
    const defense2026 = Array.isArray(window.ABILITIES_DEFENSE_2026)
        ? window.ABILITIES_DEFENSE_2026
        : [];

    const PAGE_SIZE = 50;
    const POSITION_ORDER = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "TWP"];
    const state = {
        team: "",
        position: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "speed",
        sortDirection: "desc"
    };
    const exitState = {
        team: "",
        position: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "averageVelocity",
        sortDirection: "desc"
    };
    const defenseState = {
        team: "",
        position: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "oaa",
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

    const sortedSprintRows = () => filteredRows().sort((a, b) => {
        const aValue = a[state.sortKey];
        const bValue = b[state.sortKey];
        if ((aValue === null || aValue === undefined) && (bValue === null || bValue === undefined)) {
            return b.speed - a.speed || a.player.localeCompare(b.player);
        }
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        const direction = state.sortDirection === "asc" ? 1 : -1;
        const difference = (aValue - bValue) * direction;
        return difference || b.speed - a.speed || a.player.localeCompare(b.player);
    });

    const renderTable = () => {
        const tbody = content?.querySelector("#sprint-speed-body");
        if (!tbody) return;
        const rows = sortedSprintRows();
        const visibleRows = rows.slice(0, state.visibleCount);
        tbody.innerHTML = rows.length ? visibleRows.map((row, index) => {
            const rank = index + 1;
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

        content.querySelectorAll("[data-sprint-sort]").forEach((button) => {
            const active = button.dataset.sprintSort === state.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? state.sortDirection : "";
            button.setAttribute("aria-sort", active
                ? (state.sortDirection === "desc" ? "descending" : "ascending")
                : "none");
        });

        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}人を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderSprintSpeed = () => {
        if (!content) return;
        const teams = [...new Set(sprintSpeed2026.map((row) => row.team))].sort();
        const positions = sortedPositions(sprintSpeed2026);
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-sprint-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
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
                    <thead><tr><th>順位</th><th>TEAM</th><th>選手</th><th>年齢</th><th>投/打</th><th>守備</th><th>${sortHeader("本塁→１塁", "hp1b")}</th><th>${sortHeader("内野安打<br><small>実数/安打数</small>", "infieldHits")}</th><th>${sortHeader("盗塁<br><small>成功数/企図数</small>", "stolenBases")}</th><th>${sortHeader("SPRINT SPEED km/h", "speed")}</th></tr></thead>
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
        content.querySelectorAll("[data-sprint-sort]").forEach((button) => button.addEventListener("click", () => {
            const key = button.dataset.sprintSort;
            if (state.sortKey === key) {
                state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
            } else {
                state.sortKey = key;
                state.sortDirection = key === "hp1b" ? "asc" : "desc";
            }
            resetVisibleCount();
            renderTable();
        }));
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

    const filteredDefenseRows = () => defense2026.filter((row) => {
        if (defenseState.team && row.team !== defenseState.team) return false;
        if (defenseState.position && row.position !== defenseState.position) return false;
        if (defenseState.query && !`${row.player} ${japanesePlayerName(row.player)} ${row.team}`.toLowerCase().includes(defenseState.query)) return false;
        return true;
    });

    const sortedDefenseRows = () => filteredDefenseRows().sort((a, b) => {
        const aValue = a[defenseState.sortKey];
        const bValue = b[defenseState.sortKey];
        if (aValue == null && bValue == null) return a.player.localeCompare(b.player);
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        const direction = defenseState.sortDirection === "asc" ? 1 : -1;
        return (aValue - bValue) * direction || a.player.localeCompare(b.player);
    });

    const renderDefenseTable = () => {
        const tbody = content?.querySelector("#defense-body");
        if (!tbody) return;
        const rows = sortedDefenseRows();
        const visibleRows = rows.slice(0, defenseState.visibleCount);
        const oaaUrl = (row) => `https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=Fielder&startYear=2026&endYear=2026&split=yes&min=1&playerId=${row.playerId}`;
        const fieldingUrl = (row) => `https://baseballsavant.mlb.com/leaderboard/fielding-run-value?gameType=Regular&groupBy=year&minInnings=1&minResults=1&position=0&seasonEnd=2026&seasonStart=2026&type=fielder&playerId=${row.playerId}`;
        const armUrl = (row) => `https://baseballsavant.mlb.com/leaderboard/arm-strength?type=player&year=2026&minThrows=1&playerId=${row.playerId}`;
        const link = (url, value) => `<a class="ability-value-link" href="${url}" target="_blank" rel="noopener noreferrer">${value}</a>`;
        const signed = (value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}`;
        tbody.innerHTML = rows.length ? visibleRows.map((row, index) => `<tr>
            <td class="ability-rank">${index + 1}</td>
            <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy"></td>
            <td class="ability-player">${escapeHtml(japanesePlayerName(row.player))}</td>
            <td>${row.age ?? "—"}</td><td>${row.throwBat}</td><td>${escapeHtml(row.position)}</td>
            <td class="ability-defense-value">${row.oaa == null ? "—" : link(oaaUrl(row), signed(row.oaa))}</td>
            <td class="ability-defense-value">${link(fieldingUrl(row), signed(row.fieldingRuns))}</td>
            <td class="ability-velocity">${row.armAverage == null ? "—" : link(armUrl(row), `${milesPerHourToKmh(row.armAverage).toFixed(1)} km/h`)}</td>
            <td class="ability-velocity">${row.armMax == null ? "—" : link(armUrl(row), `${milesPerHourToKmh(row.armMax).toFixed(1)} km/h`)}</td>
        </tr>`).join("") : `<tr><td colspan="10">条件に一致する選手はいません。</td></tr>`;

        content.querySelectorAll("[data-defense-sort]").forEach((button) => {
            const active = button.dataset.defenseSort === defenseState.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? defenseState.sortDirection : "";
            button.setAttribute("aria-sort", active ? (defenseState.sortDirection === "desc" ? "descending" : "ascending") : "none");
        });
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}人を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderDefense = () => {
        if (!content) return;
        const teams = [...new Set(defense2026.map((row) => row.team))].sort();
        const positions = sortedPositions(defense2026);
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-defense-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
        content.innerHTML = `
            <section class="ability-hero">
                <div><h3>野手｜守備・送球</h3></div>
                <div class="ability-scale" aria-label="OAAの基準"><div><strong>0</strong><span>MLB基準 OAA</span></div></div>
            </section>
            <div class="ability-controls">
                <select id="ability-position" aria-label="守備位置"><option value="">全ポジション</option>${positions.map((value) => `<option value="${value}">${value}</option>`).join("")}</select>
                <select id="ability-team" aria-label="チーム"><option value="">全チーム</option>${teams.map((value) => `<option value="${value}">${value}</option>`).join("")}</select>
                <input id="ability-search" type="search" placeholder="選手名・チームで検索" aria-label="選手検索">
            </div>
            <div class="ability-table-wrap"><table class="ability-table defense-table">
                <thead><tr><th>順位</th><th>TEAM</th><th>選手</th><th>年齢</th><th>投/打</th><th>守備</th><th>${sortHeader("OAA", "oaa")}</th><th>${sortHeader("守備得点価値", "fieldingRuns")}</th><th>${sortHeader("平均送球速度", "armAverage")}</th><th>${sortHeader("最速送球", "armMax")}</th></tr></thead>
                <tbody id="defense-body"></tbody>
            </table></div>
            <div class="ability-table-footer"><span id="ability-result-summary"></span><button type="button" id="ability-show-more">さらに50人表示</button></div>
            <p class="ability-table-note">2026年レギュラーシーズン／投手を除く。OAAは守備範囲、守備得点価値は守備全体の貢献を示します。送球速度はSavantの集計対象選手のみ表示し、すべてkm/hへ変換しています（2026年10月16日時点）。</p>`;

        const reset = () => { defenseState.visibleCount = PAGE_SIZE; };
        content.querySelector("#ability-position")?.addEventListener("change", (event) => { defenseState.position = event.target.value; reset(); renderDefenseTable(); });
        content.querySelector("#ability-team")?.addEventListener("change", (event) => { defenseState.team = event.target.value; reset(); renderDefenseTable(); });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => { defenseState.query = event.target.value.trim().toLowerCase(); reset(); renderDefenseTable(); });
        content.querySelectorAll("[data-defense-sort]").forEach((button) => button.addEventListener("click", () => {
            const key = button.dataset.defenseSort;
            if (defenseState.sortKey === key) defenseState.sortDirection = defenseState.sortDirection === "desc" ? "asc" : "desc";
            else { defenseState.sortKey = key; defenseState.sortDirection = "desc"; }
            reset(); renderDefenseTable();
        }));
        content.querySelector("#ability-show-more")?.addEventListener("click", () => { defenseState.visibleCount += PAGE_SIZE; renderDefenseTable(); });
        renderDefenseTable();
    };

    const showAbility = (ability) => {
        page?.querySelectorAll("[data-ability]").forEach((button) => {
            button.classList.toggle("active", button.dataset.ability === ability);
        });
        if (ability === "exit-velocity") {
            renderExitVelocity();
            return;
        }
        if (ability === "defense") {
            renderDefense();
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
