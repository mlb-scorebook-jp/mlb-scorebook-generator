(() => {
    "use strict";

    const sprintSpeed2026 = [
        { player: "Cam Cauley", playerId: 695508, team: "TEX", teamId: 140, age: 23, throwBat: "右/右", position: "CF", runs: 24, bolts: 16, hp1b: 4.09, hits: 12, infieldHits: 3, stolenBases: 1, stolenBaseAttempts: 1, speed: 30.5 },
        { player: "Henry Bolte", playerId: 703607, team: "ATH", teamId: 133, age: 22, throwBat: "右/右", position: "CF", runs: 199, bolts: 118, hp1b: 4.18, hits: 115, infieldHits: 17, stolenBases: 21, stolenBaseAttempts: 29, speed: 30.5 },
        { player: "Carlos Jorge", playerId: 699115, team: "CIN", teamId: 113, age: 22, throwBat: "右/左", position: "CF", runs: 16, bolts: 12, hp1b: null, hits: 10, infieldHits: 2, stolenBases: 2, stolenBaseAttempts: 3, speed: 30.4 },
        { player: "Eli White", playerId: 642201, team: "BOS", teamId: 111, age: 32, throwBat: "右/右", position: "RF", runs: 108, bolts: 54, hp1b: 4.19, hits: 47, infieldHits: 9, stolenBases: 5, stolenBaseAttempts: 6, speed: 30.3 },
        { player: "Jorge Mateo", playerId: 622761, team: "TB", teamId: 139, age: 31, throwBat: "右/右", position: "SS", runs: 75, bolts: 36, hp1b: 4.14, hits: 42, infieldHits: 6, stolenBases: 19, stolenBaseAttempts: 23, speed: 30.2 },
        { player: "Tommy Troy", playerId: 694371, team: "AZ", teamId: 109, age: 24, throwBat: "右/右", position: "LF", runs: 55, bolts: 30, hp1b: 4.16, hits: 28, infieldHits: 4, stolenBases: 1, stolenBaseAttempts: 1, speed: 30.1 },
        { player: "Bobby Witt Jr.", playerId: 677951, team: "KC", teamId: 118, age: 26, throwBat: "右/右", position: "SS", runs: 242, bolts: 94, hp1b: 4.17, hits: 157, infieldHits: 15, stolenBases: 45, stolenBaseAttempts: 53, speed: 30.1 },
        { player: "Jose Siri", playerId: 642350, team: "LAA", teamId: 108, age: 30, throwBat: "右/右", position: "CF", runs: 83, bolts: 31, hp1b: 4.24, hits: 55, infieldHits: 8, stolenBases: 9, stolenBaseAttempts: 10, speed: 30.0 },
        { player: "Jonah Cox", playerId: 813841, team: "SF", teamId: 137, age: 24, throwBat: "右/右", position: "CF", runs: 50, bolts: 30, hp1b: 4.18, hits: 38, infieldHits: 4, stolenBases: 16, stolenBaseAttempts: 20, speed: 30.0 },
        { player: "Jake McCarthy", playerId: 664983, team: "COL", teamId: 115, age: 28, throwBat: "左/左", position: "LF", runs: 265, bolts: 109, hp1b: 4.17, hits: 159, infieldHits: 16, stolenBases: 32, stolenBaseAttempts: 38, speed: 30.0 },
        { player: "Trea Turner", playerId: 607208, team: "PHI", teamId: 143, age: 33, throwBat: "右/右", position: "SS", runs: 236, bolts: 98, hp1b: 4.24, hits: 156, infieldHits: 18, stolenBases: 21, stolenBaseAttempts: 25, speed: 29.9 }
    ];

    const state = { team: "", position: "", query: "" };
    const feetPerSecondToKmh = (value) => value * 1.09728;
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
        tbody.innerHTML = rows.length ? rows.map((row) => {
            const rank = sprintSpeed2026.indexOf(row) + 1;
            const width = Math.max(0, Math.min(100, ((row.speed - 23) / 7.5) * 100));
            const runningUrl = savantRunningUrl(row);
            const infieldHitUrl = savantCustomUrl(row, "pa,hits,infield_hits");
            const stolenBaseUrl = savantCustomUrl(row, "pa,stolen_bases,caught_stealing");
            return `<tr>
                <td class="ability-rank">${rank}</td>
                <td class="ability-team"><img src="https://www.mlbstatic.com/team-logos/${row.teamId}.svg" alt="${escapeHtml(row.team)}" title="${escapeHtml(row.team)}" loading="lazy"></td>
                <td class="ability-player">${escapeHtml(japanesePlayerName(row.player))}</td>
                <td>${row.age}</td>
                <td>${row.throwBat}</td>
                <td>${escapeHtml(row.position)}</td>
                <td>${row.hp1b === null ? "—" : `<a class="ability-value-link" href="${runningUrl}" target="_blank" rel="noopener noreferrer">${row.hp1b.toFixed(2)}秒</a>`}</td>
                <td><a class="ability-value-link" href="${infieldHitUrl}" target="_blank" rel="noopener noreferrer">${row.infieldHits}/${row.hits}</a></td>
                <td><a class="ability-value-link" href="${stolenBaseUrl}" target="_blank" rel="noopener noreferrer">${row.stolenBases}/${row.stolenBaseAttempts}</a></td>
                <td class="ability-speed"><a class="ability-value-link" href="${runningUrl}" target="_blank" rel="noopener noreferrer"><span class="ability-speed-bar"><i style="width:${width.toFixed(1)}%"></i></span>${feetPerSecondToKmh(row.speed).toFixed(1)}</a></td>
            </tr>`;
        }).join("") : `<tr><td colspan="10">条件に一致する選手はいません。</td></tr>`;
    };

    const renderSprintSpeed = () => {
        if (!content) return;
        const teams = [...new Set(sprintSpeed2026.map((row) => row.team))].sort();
        const positions = [...new Set(sprintSpeed2026.map((row) => row.position))].sort();
        content.innerHTML = `
            <section class="ability-hero">
                <div>
                    <h3>野手｜スプリントスピード</h3>
                    <p>選手が各プレー中に記録した「最も速い1秒間」の速度。対象となる競争的走塁のうち、速い方のおよそ3分の2を平均してシーズン値を算出します。</p>
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
            <p class="ability-table-note">2026年レギュラーシーズン／最低10回。走塁速度はBaseball Savant、打撃成績はMLB公式・FanGraphsを参照（2026年10月16日時点）。</p>`;

        content.querySelector("#ability-position")?.addEventListener("change", (event) => {
            state.position = event.target.value;
            renderTable();
        });
        content.querySelector("#ability-team")?.addEventListener("change", (event) => {
            state.team = event.target.value;
            renderTable();
        });
        content.querySelector("#ability-search")?.addEventListener("input", (event) => {
            state.query = event.target.value.trim().toLowerCase();
            renderTable();
        });
        renderTable();
    };

    window.Abilities = {
        open() {
            if (!page) return;
            page.hidden = false;
            renderSprintSpeed();
        },
        close() {
            if (page) page.hidden = true;
        }
    };
})();
