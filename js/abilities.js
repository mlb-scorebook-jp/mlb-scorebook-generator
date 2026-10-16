(() => {
    "use strict";

    const sprintSpeed2026 = [
        { player: "Cam Cauley", team: "TEX", age: 23, position: "CF", runs: 24, bolts: 16, hp1b: 4.09, speed: 30.5 },
        { player: "Henry Bolte", team: "ATH", age: 22, position: "CF", runs: 199, bolts: 118, hp1b: 4.18, speed: 30.5 },
        { player: "Carlos Jorge", team: "CIN", age: 22, position: "CF", runs: 16, bolts: 12, hp1b: null, speed: 30.4 },
        { player: "Eli White", team: "BOS", age: 32, position: "RF", runs: 108, bolts: 54, hp1b: 4.19, speed: 30.3 },
        { player: "Jorge Mateo", team: "TB", age: 31, position: "SS", runs: 75, bolts: 36, hp1b: 4.14, speed: 30.2 },
        { player: "Tommy Troy", team: "AZ", age: 24, position: "LF", runs: 55, bolts: 30, hp1b: 4.16, speed: 30.1 },
        { player: "Bobby Witt Jr.", team: "KC", age: 26, position: "SS", runs: 242, bolts: 94, hp1b: 4.17, speed: 30.1 },
        { player: "Jose Siri", team: "LAA", age: 30, position: "CF", runs: 83, bolts: 31, hp1b: 4.24, speed: 30.0 },
        { player: "Jonah Cox", team: "SF", age: 24, position: "CF", runs: 50, bolts: 30, hp1b: 4.18, speed: 30.0 },
        { player: "Jake McCarthy", team: "COL", age: 28, position: "LF", runs: 265, bolts: 109, hp1b: 4.17, speed: 30.0 },
        { player: "Trea Turner", team: "PHI", age: 33, position: "SS", runs: 236, bolts: 98, hp1b: 4.24, speed: 29.9 }
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

    const filteredRows = () => sprintSpeed2026.filter((row) => {
        if (state.team && row.team !== state.team) return false;
        if (state.position && row.position !== state.position) return false;
        if (state.query && !`${row.player} ${row.team}`.toLowerCase().includes(state.query)) return false;
        return true;
    });

    const renderTable = () => {
        const tbody = content?.querySelector("#sprint-speed-body");
        if (!tbody) return;
        const rows = filteredRows();
        tbody.innerHTML = rows.length ? rows.map((row) => {
            const rank = sprintSpeed2026.indexOf(row) + 1;
            const width = Math.max(0, Math.min(100, ((row.speed - 23) / 7.5) * 100));
            return `<tr>
                <td class="ability-rank">${rank}</td>
                <td class="ability-player">${escapeHtml(row.player)}</td>
                <td class="ability-team">${escapeHtml(row.team)}</td>
                <td>${row.age}</td>
                <td>${escapeHtml(row.position)}</td>
                <td>${row.runs}</td>
                <td class="ability-bolt">${row.bolts}</td>
                <td>${row.hp1b === null ? "—" : `${row.hp1b.toFixed(2)}秒`}</td>
                <td class="ability-speed"><span class="ability-speed-bar"><i style="width:${width.toFixed(1)}%"></i></span>${feetPerSecondToKmh(row.speed).toFixed(1)}</td>
            </tr>`;
        }).join("") : `<tr><td colspan="9">条件に一致する選手はいません。</td></tr>`;
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
                    <div><strong>${feetPerSecondToKmh(30).toFixed(1)}</strong><span>BOLT基準 km/h</span></div>
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
                    <thead><tr><th>順位</th><th>選手</th><th>TEAM</th><th>年齢</th><th>守備</th><th>測定対象走塁</th><th>32.9km/h以上</th><th>本塁→一塁</th><th>SPRINT SPEED km/h</th></tr></thead>
                    <tbody id="sprint-speed-body"></tbody>
                </table>
            </div>
            <p class="ability-table-note">2026年／最低10回。Baseball Savant Sprint Speed Leaderboardを参照（2026年10月16日時点）。</p>`;

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
