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
    const catcherFielding2026 = Array.isArray(window.ABILITIES_CATCHER_FIELDING_2026)
        ? window.ABILITIES_CATCHER_FIELDING_2026
        : [];
    const catcher2026 = catcherFielding2026.map((catcherStats) => {
        const player = defense2026.find((row) => row.playerId === catcherStats.playerId && row.position === "C")
            || defense2026.find((row) => row.playerId === catcherStats.playerId);
        return player ? { ...player, ...catcherStats, position: "C" } : null;
    }).filter(Boolean);
    const abs2026 = window.ABILITIES_ABS_2026 || {};
    const absUmpires2026 = Array.isArray(window.ABILITIES_ABS_UMPIRES_2026)
        ? window.ABILITIES_ABS_UMPIRES_2026
        : [];
    const umpireNamesJa = window.ABILITIES_UMPIRE_NAMES_JA || {};
    const replay2026 = Array.isArray(window.ABILITIES_REPLAY_2026)
        ? window.ABILITIES_REPLAY_2026
        : [];
    const replayUmpires2026 = Array.isArray(window.ABILITIES_REPLAY_UMPIRES_2026)
        ? window.ABILITIES_REPLAY_UMPIRES_2026
        : [];
    const missedCalls2026 = window.ABILITIES_MISSED_CALLS_2026 || {};
    const missedCallTotalPitches = Number(missedCalls2026._meta?.totalPitches) || 0;
    const missedCallTotalCalledPitches = Number(missedCalls2026._meta?.totalCalledPitches) || 0;
    const umpireAgeById = new Map(replayUmpires2026.map((row) => [row.umpireId, row.age]));
    const replayUmpireAttempts = replayUmpires2026.reduce((total, row) => total + row.attempts, 0);
    const replayUmpireAverage = replayUmpireAttempts
        ? replayUmpires2026.reduce((total, row) => total + row.upheld, 0) / replayUmpireAttempts
        : 0;

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
    const catcherState = {
        team: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "caughtStealingRate",
        sortDirection: "desc"
    };
    const absState = {
        category: "overall",
        team: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "runsAboveAverage",
        sortDirection: "desc"
    };
    const replayState = {
        view: "team",
        team: "",
        type: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "successRate",
        sortDirection: "desc"
    };
    const missedCallState = {
        callType: "ballToStrike",
        role: "pitcher",
        team: "",
        query: "",
        visibleCount: PAGE_SIZE,
        sortKey: "calls",
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

    const japaneseTeamName = (row) =>
        window.MLB_SCOREBOOK_TEAM_NAMES_BY_ID?.[Number(row?.teamId)] || row?.name || row?.team || "—";

    const REPLAY_TYPE_NAMES = {
        "Catch/drop in outfield": "外野の捕球／落球",
        "Catcher interference": "捕手妨害",
        "Close play at 1st": "１塁のクロスプレー",
        "Defensive Shift": "守備シフト",
        "Fair/foul in outfield": "外野のフェア／ファウル",
        "Fan interference": "観客の妨害",
        "Force play": "フォースプレー",
        "Grounds rule": "グラウンドルール",
        "Hit by pitch": "死球",
        "Home run": "本塁打",
        "Home-plate collision": "本塁での衝突",
        "Passing runners": "走者の追い越し",
        "Record keeping": "記録確認",
        "Rules check": "ルール確認",
        "Slide interference": "スライディング妨害",
        "Stadium boundary call": "球場境界の判定",
        "Tag play": "タッグプレー",
        "Tag-up play": "タッチアップ",
        "Timing Play": "タイミングプレー",
        "Touching a base": "ベース接触",
        "Trap play in outfield": "外野のトラッププレー"
    };
    const replayTypeName = (type) => REPLAY_TYPE_NAMES[type] || type;

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
        const popTimeUrl = (row) => `https://baseballsavant.mlb.com/leaderboard/poptime?year=2026&team=&min2b=0&min3b=0&playerId=${row.playerId}`;
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
            <p class="ability-table-note">2026年レギュラーシーズン／投手を除く。OAAは守備範囲、守備得点価値は守備全体の貢献を示します。送球速度はSavantの集計対象選手のみ表示し、すべてkm/hへ変換しています（2026年10月17日時点）。</p>`;

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

    const catcherRows = () => catcher2026;

    const filteredCatcherRows = () => catcherRows().filter((row) => {
        if (catcherState.team && row.team !== catcherState.team) return false;
        if (catcherState.query && !`${row.player} ${japanesePlayerName(row.player)} ${row.team}`.toLowerCase().includes(catcherState.query)) return false;
        return true;
    });

    const sortedCatcherRows = () => filteredCatcherRows().sort((a, b) => {
        const aValue = a[catcherState.sortKey];
        const bValue = b[catcherState.sortKey];
        if (aValue == null && bValue == null) return a.player.localeCompare(b.player);
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        const direction = catcherState.sortDirection === "asc" ? 1 : -1;
        return (aValue - bValue) * direction || b.attempts - a.attempts || a.player.localeCompare(b.player);
    });

    const renderCatcherTable = () => {
        const tbody = content?.querySelector("#catcher-body");
        if (!tbody) return;
        const rows = sortedCatcherRows();
        const visibleRows = rows.slice(0, catcherState.visibleCount);
        const armUrl = (row) => `https://baseballsavant.mlb.com/leaderboard/arm-strength?type=player&year=2026&minThrows=1&playerId=${row.playerId}`;
        const link = (url, value) => `<a class="ability-value-link" href="${url}" target="_blank" rel="noopener noreferrer">${value}</a>`;
        tbody.innerHTML = rows.length ? visibleRows.map((row, index) => `<tr>
            <td class="ability-rank">${index + 1}</td>
            <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy"></td>
            <td class="ability-player">${escapeHtml(japanesePlayerName(row.player))}</td>
            <td>${row.age ?? "—"}</td><td>${row.throwBat}</td>
            <td class="ability-defense-value">${row.attempts ? `${row.caughtStealing}/${row.attempts}` : "—"}</td>
            <td class="ability-defense-value">${row.caughtStealingRate == null ? "—" : `${(row.caughtStealingRate * 100).toFixed(1)}%`}</td>
            <td class="ability-velocity">${row.catcherArmStrength == null ? "—" : link(popTimeUrl(row), `${milesPerHourToKmh(row.catcherArmStrength).toFixed(1)} km/h`)}</td>
            <td>${row.exchangeTime == null ? "—" : link(popTimeUrl(row), `${row.exchangeTime.toFixed(2)}秒`)}</td>
            <td>${row.popTime2b == null ? "—" : link(popTimeUrl(row), `${row.popTime2b.toFixed(2)}秒`)}</td>
        </tr>`).join("") : `<tr><td colspan="10">条件に一致する捕手はいません。</td></tr>`;
        content.querySelectorAll("[data-catcher-sort]").forEach((button) => {
            const active = button.dataset.catcherSort === catcherState.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? catcherState.sortDirection : "";
            button.setAttribute("aria-sort", active ? (catcherState.sortDirection === "desc" ? "descending" : "ascending") : "none");
        });
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}人を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderCatcher = () => {
        if (!content) return;
        const rows = catcherRows();
        const teams = [...new Set(rows.map((row) => row.team))].sort();
        const totalCaught = rows.reduce((sum, row) => sum + (row.caughtStealing || 0), 0);
        const totalAttempts = rows.reduce((sum, row) => sum + (row.attempts || 0), 0);
        const leagueRate = totalAttempts ? totalCaught / totalAttempts * 100 : 0;
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-catcher-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
        content.innerHTML = `<section class="ability-hero"><div><h3>捕手｜盗塁阻止</h3></div><div class="ability-scale"><div><strong>${leagueRate.toFixed(1)}%</strong><span>MLB全体 盗塁阻止率</span></div></div></section>
            <div class="ability-controls"><select id="ability-team"><option value="">全チーム</option>${teams.map((value) => `<option value="${value}">${value}</option>`).join("")}</select><input id="ability-search" type="search" placeholder="捕手名・チームで検索"></div>
            <div class="ability-table-wrap"><table class="ability-table catcher-table"><thead><tr><th>順位</th><th>TEAM</th><th>捕手</th><th>年齢</th><th>投/打</th><th>${sortHeader("盗塁阻止<br><small>阻止/企図</small>", "caughtStealing")}</th><th>${sortHeader("盗塁阻止率", "caughtStealingRate")}</th><th>${sortHeader("送球強度", "catcherArmStrength")}</th><th>${sortHeader("持ち替え", "exchangeTime")}</th><th>${sortHeader("二塁送球時間", "popTime2b")}</th></tr></thead><tbody id="catcher-body"></tbody></table></div>
            <div class="ability-table-footer"><span id="ability-result-summary"></span><button type="button" id="ability-show-more">さらに50人表示</button></div>
            <p class="ability-table-note">2026年レギュラーシーズン。盗塁阻止は捕手守備時の阻止数／企図数、盗塁阻止率は阻止数÷（阻止数＋盗塁許容数）です。送球強度・持ち替え・二塁送球時間はBaseball Savantの捕手専用Pop Timeデータを使用。送球強度は最大努力に近い送球群の平均で、km/hへ変換しています（2026年10月17日時点）。</p>`;
        const reset = () => { catcherState.visibleCount = PAGE_SIZE; };
        content.querySelector("#ability-team")?.addEventListener("change", (event) => { catcherState.team = event.target.value; reset(); renderCatcherTable(); });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => { catcherState.query = event.target.value.trim().toLowerCase(); reset(); renderCatcherTable(); });
        content.querySelectorAll("[data-catcher-sort]").forEach((button) => button.addEventListener("click", () => { const key = button.dataset.catcherSort; if (catcherState.sortKey === key) catcherState.sortDirection = catcherState.sortDirection === "desc" ? "asc" : "desc"; else { catcherState.sortKey = key; catcherState.sortDirection = "desc"; } reset(); renderCatcherTable(); }));
        content.querySelector("#ability-show-more")?.addEventListener("click", () => { catcherState.visibleCount += PAGE_SIZE; renderCatcherTable(); });
        renderCatcherTable();
    };

    const replayTeamRows = () => {
        const grouped = new Map();
        replay2026.filter((row) => row.challengingTeamId).forEach((row) => {
            if (!grouped.has(row.challengingTeamId)) grouped.set(row.challengingTeamId, {
                teamId: row.challengingTeamId, team: row.challengingTeam, attempts: 0, won: 0, types: new Map()
            });
            const item = grouped.get(row.challengingTeamId);
            item.attempts += 1;
            item.won += row.overturned ? 1 : 0;
            item.types.set(row.type, (item.types.get(row.type) || 0) + 1);
        });
        return [...grouped.values()].map((row) => ({
            ...row,
            successRate: row.attempts ? row.won / row.attempts : 0,
            mainType: [...row.types].sort((a, b) => b[1] - a[1])[0]?.[0] || ""
        }));
    };

    const replayTypeRows = () => {
        const grouped = new Map();
        replay2026.forEach((row) => {
            if (!grouped.has(row.type)) grouped.set(row.type, { type: row.type, attempts: 0, won: 0, teamReviews: 0, umpireReviews: 0 });
            const item = grouped.get(row.type);
            item.attempts += 1;
            item.won += row.overturned ? 1 : 0;
            if (row.challengingTeam === "Umpire") item.umpireReviews += 1;
            else item.teamReviews += 1;
        });
        return [...grouped.values()].map((row) => ({ ...row, successRate: row.attempts ? row.won / row.attempts : 0 }));
    };

    const replayRowsForView = () => replayState.view === "team"
        ? replayTeamRows()
        : replayState.view === "umpire" ? [...replayUmpires2026] : replayTypeRows();
    const replayBaseUrl = "https://baseballsavant.mlb.com/replay?year=2026";

    const renderReplaySummaryTable = () => {
        const tbody = content?.querySelector("#replay-body");
        if (!tbody) return;
        let rows = replayRowsForView();
        if (replayState.team && replayState.view === "team") rows = rows.filter((row) => row.team === replayState.team);
        if (replayState.type && replayState.view === "type") rows = rows.filter((row) => row.type === replayState.type);
        if (replayState.query) rows = rows.filter((row) => {
            const searchable = replayState.view === "team"
                ? `${row.team} ${japaneseTeamName(row)}`
                : replayState.view === "umpire"
                    ? `${row.name} ${umpireNamesJa[row.name] || ""} ${replayTypeName(row.mostOverturnedType)} ${replayTypeName(row.mostUpheldType)}`
                    : `${row.type} ${replayTypeName(row.type)}`;
            return searchable.toLowerCase().includes(replayState.query);
        });
        const direction = replayState.sortDirection === "asc" ? 1 : -1;
        rows.sort((a, b) => (a[replayState.sortKey] - b[replayState.sortKey]) * direction ||
            String(a.team || a.type || a.name).localeCompare(String(b.team || b.type || b.name)));
        const link = (value) => `<a class="ability-value-link" href="${replayBaseUrl}" target="_blank" rel="noopener noreferrer">${value}</a>`;
        tbody.innerHTML = rows.length ? rows.map((row, index) => replayState.view === "team" ? `<tr>
            <td class="ability-rank">${index + 1}</td>
            <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy"></td>
            <td class="ability-player">${escapeHtml(japaneseTeamName(row))}</td>
            <td class="ability-replay-record">${link(`${row.won}/${row.attempts}`)}</td>
            <td class="ability-replay-rate">${link(`${(row.successRate * 100).toFixed(1)}%`)}</td>
            <td>${escapeHtml(replayTypeName(row.mainType))}</td>
        </tr>` : replayState.view === "umpire" ? `<tr>
            <td class="ability-rank">${index + 1}</td>
            <td class="ability-player" title="${escapeHtml(row.name)}">${escapeHtml(umpireNamesJa[row.name] || row.name)}</td>
            <td class="replay-umpire-age">${Number.isFinite(row.age) ? `${row.age}歳` : "—"}</td>
            <td class="ability-replay-record">${link(`${row.upheld}/${row.attempts}`)}</td>
            <td class="replay-accurate ${row.upheldRate >= replayUmpireAverage ? "replay-above-average" : "replay-below-average"}">${link(`${(row.upheldRate * 100).toFixed(1)}%`)}</td>
            <td class="replay-overturned-count">${link(row.overturned)}</td>
            <td>${escapeHtml(replayTypeName(row.mostOverturnedType))}</td>
            <td>${escapeHtml(replayTypeName(row.mostUpheldType))}</td>
        </tr>` : `<tr>
            <td class="ability-rank">${index + 1}</td>
            <td class="ability-player">${escapeHtml(replayTypeName(row.type))}</td>
            <td class="ability-replay-record">${link(`${row.won}/${row.attempts}`)}</td>
            <td class="ability-replay-rate">${link(`${(row.successRate * 100).toFixed(1)}%`)}</td>
            <td>${link(row.teamReviews)}</td><td>${link(row.umpireReviews)}</td>
        </tr>`).join("") : `<tr><td colspan="${replayState.view === "umpire" ? 8 : 6}">条件に一致する記録はありません。</td></tr>`;
        content.querySelectorAll("[data-replay-sort]").forEach((button) => {
            const active = button.dataset.replaySort === replayState.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? replayState.sortDirection : "";
        });
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${rows.length}${replayState.view === "team" ? "チーム" : replayState.view === "umpire" ? "人" : "種類"}を表示`;
    };

    const filteredReplayHistory = () => replay2026.filter((row) => {
        if (replayState.team && row.challengingTeam !== replayState.team) return false;
        if (replayState.type && row.type !== replayState.type) return false;
        if (replayState.query && !`${row.batter} ${row.pitcher} ${row.awayTeam} ${row.homeTeam} ${replayTypeName(row.type)}`.toLowerCase().includes(replayState.query)) return false;
        return true;
    });

    const renderReplayHistory = () => {
        const tbody = content?.querySelector("#replay-history-body");
        if (!tbody) return;
        const rows = filteredReplayHistory();
        const visibleRows = rows.slice(0, replayState.visibleCount);
        tbody.innerHTML = rows.length ? visibleRows.map((row) => {
            const videoUrl = `https://baseballsavant.mlb.com/sporty-videos?playId=${row.playId}`;
            const initiator = row.challengingTeam === "Umpire" ? "審判" : row.challengingTeam;
            return `<tr><td>${row.date.replaceAll("-", "/")}</td><td>${row.awayTeam} @ ${row.homeTeam}</td><td>${initiator}</td><td>${escapeHtml(replayTypeName(row.type))}</td><td>${row.inning}回</td><td class="${row.overturned ? "replay-overturned" : "replay-confirmed"}">${row.overturned ? "成功" : "判定維持"}</td><td><a class="ability-value-link replay-video-link" href="${videoUrl}" target="_blank" rel="noopener noreferrer" aria-label="映像を再生" title="映像を再生">▶️</a></td></tr>`;
        }).join("") : `<tr><td colspan="7">条件に一致する記録はありません。</td></tr>`;
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}件を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderReplay = () => {
        if (!content) return;
        const views = [{ key: "team", label: "TEAM" }, { key: "type", label: "判定種類" }, { key: "umpire", label: "審判" }, { key: "history", label: "履歴" }];
        const teamCodes = [...new Set(replay2026.filter((row) => row.challengingTeamId).map((row) => row.challengingTeam))].sort();
        const types = [...new Set(replay2026.map((row) => row.type))].sort((a, b) => replayTypeName(a).localeCompare(replayTypeName(b), "ja"));
        const won = replay2026.filter((row) => row.overturned).length;
        const rate = replay2026.length ? won / replay2026.length * 100 : 0;
        const heroRate = replayState.view === "umpire" ? replayUmpireAverage * 100 : rate;
        const heroLabel = replayState.view === "umpire" ? "対象判定 平均維持率" : "MLB全体 覆った割合";
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-replay-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
        const controls = replayState.view === "team" ? `<select id="replay-team"><option value="">全チーム</option>${teamCodes.map((value) => `<option value="${value}">${value}</option>`).join("")}</select>`
            : replayState.view === "type" ? `<select id="replay-type"><option value="">全判定</option>${types.map((value) => `<option value="${value}">${replayTypeName(value)}</option>`).join("")}</select>`
            : replayState.view === "umpire" ? ""
            : `<select id="replay-team"><option value="">全チーム・審判</option><option value="Umpire">審判</option>${teamCodes.map((value) => `<option value="${value}">${value}</option>`).join("")}</select><select id="replay-type"><option value="">全判定</option>${types.map((value) => `<option value="${value}">${replayTypeName(value)}</option>`).join("")}</select>`;
        const table = replayState.view === "history" ? `<table class="ability-table replay-history-table"><thead><tr><th>日付</th><th>対戦</th><th>実施</th><th>判定種類</th><th>回</th><th>結果</th><th>VIDEO</th></tr></thead><tbody id="replay-history-body"></tbody></table>`
            : replayState.view === "team" ? `<table class="ability-table replay-table"><thead><tr><th>順位</th><th>TEAM</th><th>チーム</th><th>${sortHeader("成功/実施", "won")}</th><th>${sortHeader("成功率", "successRate")}</th><th>最多の判定</th></tr></thead><tbody id="replay-body"></tbody></table>`
            : replayState.view === "umpire" ? `<table class="ability-table replay-umpire-table"><thead><tr><th>順位</th><th>審判</th><th>年齢</th><th>${sortHeader("判定維持/対象", "upheld")}</th><th>${sortHeader("判定維持率", "upheldRate")}</th><th>${sortHeader("覆り", "overturned")}</th><th>最多覆り判定</th><th>最多維持判定</th></tr></thead><tbody id="replay-body"></tbody></table>`
            : `<table class="ability-table replay-type-table"><thead><tr><th>順位</th><th>判定種類</th><th>${sortHeader("成功/実施", "won")}</th><th>${sortHeader("成功率", "successRate")}</th><th>${sortHeader("チーム", "teamReviews")}</th><th>${sortHeader("審判", "umpireReviews")}</th></tr></thead><tbody id="replay-body"></tbody></table>`;
        content.innerHTML = `<section class="ability-hero"><div><h3>チャレンジ｜プレー判定</h3></div><div class="ability-scale"><div><strong>${heroRate.toFixed(1)}%</strong><span>${heroLabel}</span></div></div></section>
            <div class="ability-subtabs replay-subtabs">${views.map((item) => `<button type="button" data-replay-view="${item.key}" class="${item.key === replayState.view ? "active" : ""}">${item.label}</button>`).join("")}</div>
            <div class="ability-controls replay-controls${replayState.view === "umpire" ? " replay-umpire-controls" : ""}">${controls}<input id="replay-search" type="search" placeholder="検索"></div>
            <div class="ability-table-wrap">${table}</div><div class="ability-table-footer"><span id="ability-result-summary"></span>${replayState.view === "history" ? '<button type="button" id="ability-show-more">さらに50件表示</button>' : ""}</div>
            <p class="ability-table-note">2026年レギュラーシーズン。TEAMは監督チャレンジのみ。判定種類と履歴には審判主導レビューも含みます。審判ランキングは担当を確実に特定できる１塁クロスプレー、死球、捕手妨害、本塁衝突の589件のみを集計しており、全判定の評価ではありません。Baseball Savant公式Instant Replay Database・MLB公式試合記録を参照（2026年10月16日時点）。</p>`;
        content.querySelectorAll("[data-replay-view]").forEach((button) => button.addEventListener("click", () => { replayState.view = button.dataset.replayView; replayState.team = ""; replayState.type = ""; replayState.query = ""; replayState.visibleCount = PAGE_SIZE; replayState.sortKey = replayState.view === "umpire" ? "upheldRate" : "successRate"; replayState.sortDirection = "desc"; renderReplay(); }));
        content.querySelector("#replay-team")?.addEventListener("change", (event) => { replayState.team = event.target.value; replayState.visibleCount = PAGE_SIZE; replayState.view === "history" ? renderReplayHistory() : renderReplaySummaryTable(); });
        content.querySelector("#replay-type")?.addEventListener("change", (event) => { replayState.type = event.target.value; replayState.visibleCount = PAGE_SIZE; replayState.view === "history" ? renderReplayHistory() : renderReplaySummaryTable(); });
        content.querySelector("#replay-search")?.addEventListener("input", (event) => { replayState.query = event.target.value.trim().toLowerCase(); replayState.visibleCount = PAGE_SIZE; replayState.view === "history" ? renderReplayHistory() : renderReplaySummaryTable(); });
        content.querySelectorAll("[data-replay-sort]").forEach((button) => button.addEventListener("click", () => { const key = button.dataset.replaySort; if (replayState.sortKey === key) replayState.sortDirection = replayState.sortDirection === "desc" ? "asc" : "desc"; else { replayState.sortKey = key; replayState.sortDirection = "desc"; } renderReplaySummaryTable(); }));
        content.querySelector("#ability-show-more")?.addEventListener("click", () => { replayState.visibleCount += PAGE_SIZE; renderReplayHistory(); });
        replayState.view === "history" ? renderReplayHistory() : renderReplaySummaryTable();
    };

    const absRows = () => absState.category === "umpire"
        ? absUmpires2026
        : Array.isArray(abs2026[absState.category]) ? abs2026[absState.category] : [];

    const absLeaderboardUrl = () => {
        if (absState.category === "umpire") return "https://baseballsavant.mlb.com/leaderboard/abs-challenges";
        const challengeType = absState.category === "overall" ? "team-summary" : absState.category;
        const fielderMode = ["pitcher", "catcher"].includes(absState.category) ? "&fielderMode=as-challenger" : "";
        return `https://baseballsavant.mlb.com/leaderboard/abs-challenges?challengeType=${challengeType}${fielderMode}&gameType%5B%5D=R&level=mlb&minChal=1&minOppChal=0&season%5B%5D=2026&splitYear=1`;
    };

    const filteredAbsRows = () => absRows().filter((row) => {
        if (absState.category === "umpire") {
            const japaneseName = umpireNamesJa[row.name] || "";
            return !absState.query || `${row.name} ${japaneseName}`.toLowerCase().includes(absState.query);
        }
        if (absState.team && row.team !== absState.team) return false;
        const displayName = absState.category === "overall" ? japaneseTeamName(row) : japanesePlayerName(row.name);
        if (absState.query && !`${row.name} ${displayName} ${row.team}`.toLowerCase().includes(absState.query)) return false;
        return true;
    });

    const sortedAbsRows = () => filteredAbsRows().sort((a, b) => {
        const direction = absState.sortDirection === "asc" ? 1 : -1;
        return (a[absState.sortKey] - b[absState.sortKey]) * direction || a.name.localeCompare(b.name);
    });

    const renderAbsTable = () => {
        const tbody = content?.querySelector("#abs-body");
        if (!tbody) return;
        const rows = sortedAbsRows();
        const visibleRows = rows.slice(0, absState.visibleCount);
        const url = absLeaderboardUrl();
        const valueLink = (value) => `<a class="ability-value-link" href="${url}" target="_blank" rel="noopener noreferrer">${value}</a>`;
        if (absState.category === "umpire") {
            const teamRecord = (teamId, team, won, challenges) => `<span class="ability-umpire-team-record"><img src="https://www.mlbstatic.com/team-logos/${teamId}.svg" alt="${escapeHtml(japaneseTeamName({ team, teamId }))}" title="${escapeHtml(japaneseTeamName({ team, teamId }))}" loading="lazy"><strong>${won}/${challenges}</strong></span>`;
            tbody.innerHTML = rows.length ? visibleRows.map((row, index) => `<tr>
                <td class="ability-rank">${index + 1}</td>
                <td class="ability-player" title="${escapeHtml(row.name)}">${escapeHtml(umpireNamesJa[row.name] || row.name)}</td>
                <td class="replay-umpire-age">${Number.isFinite(umpireAgeById.get(row.umpireId)) ? `${umpireAgeById.get(row.umpireId)}歳` : "—"}</td>
                <td class="ability-abs-record">${row.overturned}/${row.challenges}</td>
                <td class="ability-abs-rate">${(row.overturnRate * 100).toFixed(1)}%</td>
                <td class="ability-abs-distance">${(row.maxEdgeDistance * 2.54).toFixed(1)} cm</td>
                <td class="ability-umpire-top-team">${teamRecord(row.topRequestTeamId, row.topRequestTeam, row.topRequestWon, row.topRequestChallenges)}</td>
                <td class="ability-umpire-top-team">${teamRecord(row.topSuccessTeamId, row.topSuccessTeam, row.topSuccessWon, row.topSuccessChallenges)}</td>
            </tr>`).join("") : `<tr><td colspan="8">条件に一致する記録はありません。</td></tr>`;
        } else tbody.innerHTML = rows.length ? visibleRows.map((row, index) => {
            const name = absState.category === "overall" ? japaneseTeamName(row) : japanesePlayerName(row.name);
            const signedRuns = `${row.runsAboveAverage > 0 ? "+" : ""}${row.runsAboveAverage.toFixed(1)}`;
            return `<tr>
                <td class="ability-rank">${index + 1}</td>
                <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy"></td>
                <td class="ability-player">${escapeHtml(name)}</td>
                <td class="ability-abs-record">${valueLink(`${row.won}/${row.challenges}`)}</td>
                <td class="ability-abs-rate">${valueLink(`${(row.winRate * 100).toFixed(1)}%`)}</td>
                <td class="ability-abs-distance">${valueLink(`${(row.maxEdgeDistance * 2.54).toFixed(1)} cm`)}</td>
                <td>${valueLink(row.strikeouts)}</td>
                <td>${valueLink(row.walks)}</td>
                <td class="ability-defense-value">${valueLink(signedRuns)}</td>
            </tr>`;
        }).join("") : `<tr><td colspan="9">条件に一致する記録はありません。</td></tr>`;

        content.querySelectorAll("[data-abs-sort]").forEach((button) => {
            const active = button.dataset.absSort === absState.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? absState.sortDirection : "";
            button.setAttribute("aria-sort", active ? (absState.sortDirection === "desc" ? "descending" : "ascending") : "none");
        });
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}${absState.category === "overall" ? "チーム" : "人"}を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderAbs = () => {
        if (!content) return;
        const categories = [{ key: "overall", label: "TEAM" }, { key: "pitcher", label: "投手" }, { key: "catcher", label: "捕手" }, { key: "batter", label: "打者" }, { key: "umpire", label: "審判" }];
        const rows = absRows();
        const isUmpire = absState.category === "umpire";
        const teams = isUmpire ? [] : [...new Set(rows.map((row) => row.team))].sort();
        const totalChallenges = rows.reduce((total, row) => total + row.challenges, 0);
        const totalWon = rows.reduce((total, row) => total + (isUmpire ? row.overturned : row.won), 0);
        const leagueRate = totalChallenges ? totalWon / totalChallenges * 100 : 0;
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-abs-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
        content.innerHTML = `
            <section class="ability-hero">
                <div><h3>ABS｜ボール・ストライク判定</h3></div>
                <div class="ability-scale"><div><strong>${leagueRate.toFixed(1)}%</strong><span>${isUmpire ? "審判別 覆った割合" : `${absState.category === "overall" ? "MLB全体" : categories.find((item) => item.key === absState.category)?.label} 成功率`}</span></div></div>
            </section>
            <div class="ability-subtabs abs-subtabs" role="tablist" aria-label="ABS集計区分">
                ${categories.map((item) => `<button type="button" role="tab" data-abs-category="${item.key}" class="${item.key === absState.category ? "active" : ""}" aria-selected="${item.key === absState.category}">${item.label}</button>`).join("")}
            </div>
            <div class="ability-controls abs-controls${isUmpire ? " abs-umpire-controls" : ""}">
                ${isUmpire ? "" : `<select id="ability-team" aria-label="チーム"><option value="">全チーム</option>${teams.map((value) => `<option value="${value}" ${value === absState.team ? "selected" : ""}>${value}</option>`).join("")}</select>`}
                <input id="ability-search" type="search" value="${escapeHtml(absState.query)}" placeholder="${isUmpire ? "審判名で検索" : absState.category === "overall" ? "チーム名で検索" : "選手名・チームで検索"}" aria-label="ABS検索">
            </div>
            <div class="ability-table-wrap"><table class="ability-table abs-table${isUmpire ? " abs-umpire-table" : ""}">
                <thead>${isUmpire ? `<tr><th>順位</th><th>審判</th><th>年齢</th><th>${sortHeader("覆り/対象", "overturned")}</th><th>${sortHeader("覆り率", "overturnRate")}</th><th>${sortHeader("最大距離<br><small>ゾーン端から</small>", "maxEdgeDistance")}</th><th>${sortHeader("最多要求チーム<br><small>成功/要求</small>", "topRequestChallenges")}</th><th>${sortHeader("最多成功チーム<br><small>成功/要求</small>", "topSuccessWon")}</th></tr>` : `<tr><th>順位</th><th>TEAM</th><th>${absState.category === "overall" ? "チーム" : "選手"}</th><th>${sortHeader("成功/実施", "won")}</th><th>${sortHeader("成功率", "winRate")}</th><th>${sortHeader("最大距離<br><small>ゾーン端から</small>", "maxEdgeDistance")}</th><th>${sortHeader("+K", "strikeouts")}</th><th>${sortHeader("-BB", "walks")}</th><th>${sortHeader("平均比", "runsAboveAverage")}</th></tr>`}</thead>
                <tbody id="abs-body"></tbody>
            </table></div>
            <div class="ability-table-footer"><span id="ability-result-summary"></span><button type="button" id="ability-show-more">さらに50件表示</button></div>
            <p class="ability-table-note">${isUmpire ? "2026年レギュラーシーズン／球審を務めた試合でABSチャレンジの対象になった判定を集計。チーム欄の数字は成功/要求です。「最多要求」は要求数、「最多成功」は成功数が最も多いチーム。成功数は公開データで確認できる誤判定数で、チャレンジされなかった判定は集計対象外です。" : "2026年レギュラーシーズン／1回以上チャレンジしたチーム・選手。成功は判定覆り、失敗は判定維持。「平均比」は同じ状況・同じ投球を経験した平均的な選手との得点価値差です。"}Baseball Savant公式ABS集計・MLB公式試合記録を参照（2026年10月16日時点）。</p>`;

        content.querySelectorAll("[data-abs-category]").forEach((button) => button.addEventListener("click", () => {
            absState.category = button.dataset.absCategory;
            absState.team = "";
            absState.query = "";
            absState.visibleCount = PAGE_SIZE;
            absState.sortKey = absState.category === "umpire" ? "overturnRate" : "runsAboveAverage";
            absState.sortDirection = "desc";
            renderAbs();
        }));
        content.querySelector("#ability-team")?.addEventListener("change", (event) => { absState.team = event.target.value; absState.visibleCount = PAGE_SIZE; renderAbsTable(); });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => { absState.query = event.target.value.trim().toLowerCase(); absState.visibleCount = PAGE_SIZE; renderAbsTable(); });
        content.querySelectorAll("[data-abs-sort]").forEach((button) => button.addEventListener("click", () => {
            const key = button.dataset.absSort;
            if (absState.sortKey === key) absState.sortDirection = absState.sortDirection === "desc" ? "asc" : "desc";
            else { absState.sortKey = key; absState.sortDirection = "desc"; }
            absState.visibleCount = PAGE_SIZE;
            renderAbsTable();
        }));
        content.querySelector("#ability-show-more")?.addEventListener("click", () => { absState.visibleCount += PAGE_SIZE; renderAbsTable(); });
        renderAbsTable();
    };

    const missedCallRows = () => Array.isArray(missedCalls2026[missedCallState.callType]?.[missedCallState.role])
        ? missedCalls2026[missedCallState.callType][missedCallState.role]
        : [];

    const missedCallSearchUrl = (playerId) => {
        const outsideStrike = missedCallState.callType === "ballToStrike";
        const result = outsideStrike ? "called%5C.%5C.strike%7C" : "ball%7C";
        const zones = outsideStrike ? "11%7C12%7C13%7C14%7C" : "1%7C2%7C3%7C4%7C5%7C6%7C7%7C8%7C9%7C";
        const lookup = missedCallState.role === "batter" ? "batters_lookup%5B%5D" : "pitchers_lookup%5B%5D";
        return `https://baseballsavant.mlb.com/statcast_search?hfGT=R%7C&hfPR=${result}&hfZ=${zones}&hfSea=2026%7C&player_type=${missedCallState.role}&${lookup}=${playerId}&group_by=name-event&sort_col=pitches&sort_order=desc#results`;
    };

    const renderMissedCallTable = () => {
        const tbody = content?.querySelector("#missed-call-body");
        if (!tbody) return;
        const direction = missedCallState.sortDirection === "asc" ? 1 : -1;
        let rows = missedCallRows().filter((row) => {
            if (missedCallState.team && String(row.teamId) !== missedCallState.team) return false;
            const displayName = japanesePlayerName(row.name);
            const umpireName = umpireNamesJa[row.topUmpire] || row.topUmpire;
            return !missedCallState.query || `${row.name} ${displayName} ${row.position} ${row.topUmpire} ${umpireName}`.toLowerCase().includes(missedCallState.query);
        });
        rows.sort((a, b) => (a[missedCallState.sortKey] - b[missedCallState.sortKey]) * direction || a.name.localeCompare(b.name));
        const visibleRows = rows.slice(0, missedCallState.visibleCount);
        const link = (value, url) => `<a class="ability-value-link" href="${url}" target="_blank" rel="noopener noreferrer" title="この選手の該当投球をBaseball Savantで確認">${value}</a>`;
        tbody.innerHTML = rows.length ? visibleRows.map((row, index) => {
            const url = missedCallSearchUrl(row.playerId);
            const positionPlayerPitching = missedCallState.role === "pitcher" && !["P", "TWP"].includes(row.position);
            return `<tr>
            <td class="ability-rank">${index + 1}</td>
            <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(japaneseTeamName({ teamId: row.teamId }))}" title="${escapeHtml(japaneseTeamName({ teamId: row.teamId }))}" loading="lazy"></td>
            <td class="ability-player" title="${escapeHtml(row.name)}">${escapeHtml(japanesePlayerName(row.name))}${positionPlayerPitching ? '<small class="ability-position-player-pitching">（野手登板）</small>' : ""}</td>
            <td class="ability-missed-count">${link(row.calls, url)}</td>
            <td class="ability-missed-impact">${link(row.impact, url)}</td>
            <td class="ability-abs-distance">${link(`${row.maxDistanceCm.toFixed(1)} cm`, url)}</td>
            <td class="ability-missed-umpire" title="${escapeHtml(row.topUmpire)}"><span class="ability-missed-umpire-layout"><span>${escapeHtml(umpireNamesJa[row.topUmpire] || row.topUmpire)}</span><small>${row.topUmpireCount}回</small></span></td>
        </tr>`;
        }).join("") : `<tr><td colspan="7">条件に一致する記録はありません。</td></tr>`;
        content.querySelectorAll("[data-missed-sort]").forEach((button) => {
            const active = button.dataset.missedSort === missedCallState.sortKey;
            button.classList.toggle("active", active);
            button.dataset.direction = active ? missedCallState.sortDirection : "";
        });
        const summary = content.querySelector("#ability-result-summary");
        if (summary) summary.textContent = `${Math.min(visibleRows.length, rows.length)} / ${rows.length}人を表示`;
        const moreButton = content.querySelector("#ability-show-more");
        if (moreButton) moreButton.hidden = visibleRows.length >= rows.length;
    };

    const renderMissedCalls = () => {
        const rows = missedCallRows();
        const callTypes = [{ key: "ballToStrike", label: "ボール球 → ストライク判定" }, { key: "strikeToBall", label: "ストライク → ボール判定" }];
        const roles = [{ key: "pitcher", label: "投手" }, { key: "batter", label: "野手" }];
        const teamIds = [...new Set(rows.map((row) => row.teamId))].sort((a, b) => japaneseTeamName({ teamId: a }).localeCompare(japaneseTeamName({ teamId: b }), "ja"));
        const totalCalls = rows.reduce((total, row) => total + row.calls, 0);
        const missedRate = missedCallTotalCalledPitches ? totalCalls / missedCallTotalCalledPitches * 100 : 0;
        const impactLabel = missedCallState.callType === "ballToStrike" ? "三振直結" : "四球直結";
        const distanceLabel = missedCallState.callType === "ballToStrike" ? "最大外れ幅" : "最大内側幅";
        const sortHeader = (label, key) => `<button type="button" class="ability-sort-button" data-missed-sort="${key}">${label}<span aria-hidden="true"></span></button>`;
        content.innerHTML = `<section class="ability-hero"><div><h3>誤審｜ボール・ストライク判定</h3></div><div class="ability-scale missed-call-scale"><div><strong>${totalCalls.toLocaleString("ja-JP")}</strong><span>誤審数</span></div><div><strong>${missedCallTotalCalledPitches.toLocaleString("ja-JP")}</strong><span>見逃し判定数</span></div><div><strong>${missedRate.toFixed(2)}%</strong><span>誤審率</span></div><div><strong>${missedCallTotalPitches.toLocaleString("ja-JP")}</strong><span>MLB総投球数</span></div></div></section>
            <div class="ability-subtabs missed-role-tabs">${roles.map((item) => `<button type="button" data-missed-role="${item.key}" class="${item.key === missedCallState.role ? "active" : ""}">${item.label}</button>`).join("")}</div>
            <div class="ability-subtabs missed-call-tabs">${callTypes.map((item) => `<button type="button" data-missed-call-type="${item.key}" class="${item.key === missedCallState.callType ? "active" : ""}" title="${item.key === "ballToStrike" ? "ボール球 → ストライク判定" : "ストライク → ボール判定"}">${item.label}</button>`).join("")}</div>
            <div class="ability-controls missed-call-controls"><select id="ability-team"><option value="">全チーム</option>${teamIds.map((teamId) => `<option value="${teamId}">${japaneseTeamName({ teamId })}</option>`).join("")}</select><input id="ability-search" type="search" placeholder="選手名・球審名で検索"></div>
            <div class="ability-table-wrap"><table class="ability-table missed-call-table"><thead><tr><th>順位</th><th>TEAM</th><th>選手</th><th>${sortHeader("判定数", "calls")}</th><th>${sortHeader(impactLabel, "impact")}</th><th>${sortHeader(distanceLabel, "maxDistanceCm")}</th><th>${sortHeader("最多の球審（回数）", "topUmpireCount")}</th></tr></thead><tbody id="missed-call-body"></tbody></table></div>
            <div class="ability-table-footer"><span id="ability-result-summary"></span><button type="button" id="ability-show-more">さらに50件表示</button></div>
            <p class="ability-table-note">2026年レギュラーシーズン。誤審率は該当判定数を、打者が振らず球審がボール／ストライクを宣告した「見逃し判定数」で割った割合です。MLB総投球数は参考値。Baseball SavantのStatcastゾーン（1〜9＝ゾーン内、11〜14＝ゾーン外）と実際の球審判定が一致しなかった投球を集計。「誤審」は実況用の便宜的な表現で、MLBが個別判定を誤審認定したものではありません。球審はMLB公式試合記録と試合IDで照合（2026年10月16日時点）。</p>`;
        content.querySelectorAll("[data-missed-call-type]").forEach((button) => button.addEventListener("click", () => { missedCallState.callType = button.dataset.missedCallType; missedCallState.team = ""; missedCallState.query = ""; missedCallState.visibleCount = PAGE_SIZE; missedCallState.sortKey = "calls"; missedCallState.sortDirection = "desc"; renderMissedCalls(); }));
        content.querySelectorAll("[data-missed-role]").forEach((button) => button.addEventListener("click", () => { missedCallState.role = button.dataset.missedRole; missedCallState.team = ""; missedCallState.query = ""; missedCallState.visibleCount = PAGE_SIZE; missedCallState.sortKey = "calls"; missedCallState.sortDirection = "desc"; renderMissedCalls(); }));
        content.querySelector("#ability-team")?.addEventListener("change", (event) => { missedCallState.team = event.target.value; missedCallState.visibleCount = PAGE_SIZE; renderMissedCallTable(); });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => { missedCallState.query = event.target.value.trim().toLowerCase(); missedCallState.visibleCount = PAGE_SIZE; renderMissedCallTable(); });
        content.querySelectorAll("[data-missed-sort]").forEach((button) => button.addEventListener("click", () => { const key = button.dataset.missedSort; if (missedCallState.sortKey === key) missedCallState.sortDirection = missedCallState.sortDirection === "desc" ? "asc" : "desc"; else { missedCallState.sortKey = key; missedCallState.sortDirection = "desc"; } renderMissedCallTable(); }));
        content.querySelector("#ability-show-more")?.addEventListener("click", () => { missedCallState.visibleCount += PAGE_SIZE; renderMissedCallTable(); });
        renderMissedCallTable();
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
        if (ability === "catcher") {
            renderCatcher();
            return;
        }
        if (ability === "abs") {
            renderAbs();
            return;
        }
        if (ability === "replay") {
            renderReplay();
            return;
        }
        if (ability === "missed-calls") {
            renderMissedCalls();
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
