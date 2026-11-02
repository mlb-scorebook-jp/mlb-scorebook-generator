(() => {
    "use strict";

    const page = document.getElementById("awards-page");
    const content = document.getElementById("awards-content");
    const data = window.MLB_AWARDS_2026 || {};
    const historyData = window.MLB_AWARDS_HISTORY || {};
    const majorHistoryData = window.MLB_AWARDS_MAJOR_HISTORY || {};
    const categories = data.categories || {};
    const seasons = Array.from({ length: 20 }, (_, index) => 2026 - index);
    const groups = [
        { key: "major", label: "主要表彰" },
        { key: "battingDefense", label: "打撃・守備" },
        { key: "special", label: "特別表彰" },
        { key: "postseason", label: "大会MVP" }
    ];
    const initialSeason = Number(new URLSearchParams(location.hash.slice(1)).get("season")) || 2026;
    const state = { group: "battingDefense", category: "goldGlove", season: seasons.includes(initialSeason) ? initialSeason : 2026 };

    const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    const logoUrl = (teamId) => `https://www.mlbstatic.com/team-logos/${Number(teamId)}.svg`;
    const categoryKeys = (groupKey) => Object.entries(categories)
        .filter(([, category]) => category.group === groupKey)
        .map(([key]) => key);
    const metricKeys = ["FRV", "DRS", "OAA", "守備機会", "失策", "守備率"];
    const metricDescriptions = {
        FRV: "Fielding Run Value：Statcastの総合守備指標。野手は捕球範囲（OAA）や送球、捕手はフレーミング・盗塁阻止・ブロッキングなどを得点に換算する。+10なら平均的な守備より約10点多く防いだ評価。",
        DRS: "Defensive Runs Saved：平均的な選手と比べて守備で何点防いだか。プラスほど優秀。",
        OAA: "Outs Above Average：平均的な選手より多く奪ったアウト数。プラスほど優秀。",
        守備機会: "刺殺・補殺・失策の合計。守備でプレーに関与した公式記録上の回数。複数ポジション分を含むシーズン合計。",
        失策: "MLB公式記録上の失策数。複数ポジションを守った選手はシーズン合計。",
        守備率: "（刺殺＋補殺）÷守備機会。失策せずに処理した割合で、1.000に近いほど高い。"
    };
    const metricValues = (winner) => {
        const values = Object.fromEntries((winner.metrics || []).map((metric) => [metric.label, metric.value]));
        values.守備機会 = winner.chances;
        values.失策 = winner.errors;
        values.守備率 = winner.fieldingPct || (winner.chances ? ((winner.chances - winner.errors) / winner.chances).toFixed(3).replace(/^0/, "") : "—");
        return metricKeys.map((key) => `<b title="${key}">${escapeHtml(values[key] ?? "—")}</b>`).join("");
    };

    const winnerCard = (winner, league) => `
        <article class="awards-winner-card awards-winner-${league.toLowerCase()} ${winner.count === 1 ? "is-first-time" : "is-repeat"}">
            <img class="awards-team-logo" src="${logoUrl(winner.teamId)}" alt="${escapeHtml(winner.team)}" loading="lazy">
            <div class="awards-winner-copy">
                <strong>${escapeHtml(winner.playerJa)}</strong>
                <b>${winner.count === 1 ? "初受賞" : `${winner.count}度目`}</b>
            </div>
            <div class="awards-winner-metrics">${metricValues(winner)}</div>
        </article>`;

    const groupNav = () => `
        <nav class="awards-group-nav" aria-label="表彰分類">
            ${groups.map((group) => `<button type="button" data-award-group="${group.key}"
                class="${state.group === group.key ? "active" : ""}">${group.label}</button>`).join("")}
        </nav>`;

    const categoryNav = () => `
        <nav class="awards-category-nav" aria-label="表彰カテゴリー">
            ${categoryKeys(state.group).map((key) => {
                const category = categories[key];
                const hasHistoricalData = key === "goldGlove" ? Boolean(historyData[state.season]) : Boolean(majorHistoryData[state.season]?.[key]);
                const statusText = state.season === 2026 ? (category.status === "announced" ? "発表済み" : "発表待ち")
                    : hasHistoricalData ? "データあり" : "未登録";
                return `<button type="button" data-award-category="${key}"
                    class="${state.category === key ? "active" : ""}">${escapeHtml(category.label)}
                    <small>${statusText}</small></button>`;
            }).join("")}
        </nav>`;

    const hero = (category) => `
        <section class="awards-hero">
            <div><span class="awards-kicker">${state.season} MLB AWARDS</span><h2>${escapeHtml(category.label)}</h2>
                <p>${escapeHtml(category.description || `${state.season}年シーズンの主要表彰`)}</p></div>
            <div class="awards-hero-meta"><label for="awards-season-select">シーズン</label>
                <select id="awards-season-select" class="awards-season-select">${seasons.map((season) => `<option value="${season}" ${season === state.season ? "selected" : ""}>${season}</option>`).join("")}</select>
                <span>${state.season === 2026 ? (category.status === "announced" ? "発表済み" : "発表待ち") : "歴代受賞者"}</span></div>
        </section>`;

    const renderGoldGloveBody = (award) => {
        const teamLeaders = award.summary.teamLeaders.map((row) => `<span class="awards-summary-team">
            <img src="${logoUrl(row.teamId)}" alt="${escapeHtml(row.team)}"><b>${row.count}人</b></span>`).join("");
        return `<section class="awards-summary" aria-label="2026年ゴールドグラブ概要">
                <div><small>受賞者</small><strong>${award.winners.length * 2}人</strong></div>
                <div><small>初受賞</small><strong>${award.summary.firstTimeWinners}人</strong></div>
                <div class="awards-summary-leaders"><small>球団最多</small>${teamLeaders}</div>
            </section>
            <p class="awards-metric-legend">OAA＝平均的な守備より増やしたアウト数　DRS＝守備で防いだ得点　FRV＝Statcastによる守備得点価値</p>
            <div class="awards-comparison-head" aria-hidden="true"><span>守備位置</span>
                <div class="awards-league-head"><strong>AMERICAN LEAGUE</strong><div>${metricKeys.map((key) => `<b class="awards-metric-help" tabindex="0" data-tooltip="${escapeHtml(metricDescriptions[key])}">${key}</b>`).join("")}</div></div>
                <div class="awards-league-head"><strong>NATIONAL LEAGUE</strong><div>${metricKeys.map((key) => `<b class="awards-metric-help" tabindex="0" data-tooltip="${escapeHtml(metricDescriptions[key])}">${key}</b>`).join("")}</div></div>
            </div>
            <section class="awards-winners">${award.winners.map((row) => `<div class="awards-position-row">
                <div class="awards-position"><b>${escapeHtml(row.position)}</b><span>${escapeHtml(row.positionJa)}</span></div>
                ${winnerCard(row.al, "AL")}${winnerCard(row.nl, "NL")}</div>`).join("")}</section>`;
    };

    const renderHistoricalGoldGlove = () => {
        const season = historyData[state.season];
        if (!season) return `<section class="awards-pending"><h3>${state.season}年</h3><p>受賞者データがありません。</p></section>`;
        const leagueColumn = (rows, league) => `<section class="awards-history-league awards-history-${league.toLowerCase()}">
            <div class="awards-history-head"><h3>${league === "AL" ? "AMERICAN LEAGUE" : "NATIONAL LEAGUE"}</h3>
                <div>${metricKeys.map((key) => `<b class="awards-metric-help" tabindex="0" data-tooltip="${escapeHtml(metricDescriptions[key])}">${key}</b>`).join("")}</div></div>
            <div>${rows.map((winner) => `<article class="awards-history-winner">
                <b class="awards-history-position">${escapeHtml(winner.position)}</b>
                <img src="${logoUrl(winner.teamId)}" alt="${escapeHtml(winner.team)}" loading="lazy">
                <strong>${escapeHtml(winner.playerJa)}</strong>
                <div class="awards-history-metrics">${metricValues(winner)}</div>
            </article>`).join("")}</div>
        </section>`;
        return `<section class="awards-history-grid">${leagueColumn(season.al, "AL")}${leagueColumn(season.nl, "NL")}</section>`;
    };

    const renderHistoricalMajorPair = () => {
        const award = majorHistoryData[state.season]?.[state.category];
        if (!award) return renderPending(categories.mvp);
        const laurel = (side) => `<svg class="awards-mvp-laurel awards-mvp-laurel-${side}" viewBox="0 0 52 34" aria-hidden="true">
            <path d="M46 31C27 28 13 17 7 3"/><ellipse cx="39" cy="27" rx="7" ry="3" transform="rotate(24 39 27)"/><ellipse cx="30" cy="23" rx="7" ry="3" transform="rotate(34 30 23)"/><ellipse cx="22" cy="17" rx="7" ry="3" transform="rotate(48 22 17)"/><ellipse cx="15" cy="10" rx="7" ry="3" transform="rotate(58 15 10)"/><ellipse cx="45" cy="22" rx="7" ry="3" transform="rotate(-16 45 22)"/><ellipse cx="36" cy="17" rx="7" ry="3" transform="rotate(-6 36 17)"/><ellipse cx="27" cy="11" rx="7" ry="3" transform="rotate(8 27 11)"/>
        </svg>`;
        const awardTitle = award.title || "MOST VALUABLE PLAYER";
        const card = (winner, league) => `<article class="awards-mvp-card awards-mvp-${league.toLowerCase()}">
            <header><span>${escapeHtml(winner.league)}</span><b>${escapeHtml(awardTitle)}</b></header>
            <div class="awards-mvp-profile">
                <div class="awards-mvp-wreath">${laurel("left")}<strong>MVP</strong>${laurel("right")}</div>
                <span class="awards-mvp-year">${state.season}</span>
                <div class="awards-mvp-portrait"><img class="awards-mvp-headshot" src="https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${winner.playerId}/headshot/silo/current" alt="${escapeHtml(winner.playerJa)}"></div>
                <img class="awards-mvp-team" src="${logoUrl(winner.teamId)}" alt="${escapeHtml(winner.team)}">
                <div class="awards-mvp-name"><small>${escapeHtml(winner.position)}</small><div class="awards-mvp-name-line"><h3>${escapeHtml(winner.playerJa)}</h3><b class="awards-mvp-count">${winner.count === 1 ? "初受賞" : `${winner.count}回目${winner.streak > 1 ? `（${winner.streak}年連続）` : ""}`}</b></div><span>${escapeHtml(winner.player)}</span></div>
            </div>
            <div class="awards-mvp-stats" style="grid-template-columns:repeat(${Object.keys(winner.stats).length},1fr)">${Object.entries(winner.stats).map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
        </article>`;
        return `<section class="awards-mvp-grid">${card(award.al, "AL")}${card(award.nl, "NL")}</section>`;
    };

    const renderHistoricalAllMlb = () => {
        const award = majorHistoryData[state.season]?.allMlb;
        if (!award) return renderPending(categories.allMlb);
        const team = (title, rows) => `<section class="awards-allmlb-team"><h3>${title}</h3><div>${rows.map(([position, player, teamAbbr, teamId]) => `<article><b>${escapeHtml(position)}</b><img src="${logoUrl(teamId)}" alt="${escapeHtml(teamAbbr)}"><strong>${escapeHtml(player)}</strong></article>`).join("")}</div></section>`;
        return `<section class="awards-allmlb-grid">${team("FIRST TEAM", award.first)}${team("SECOND TEAM", award.second)}</section>`;
    };

    const renderSimpleWinners = (category) => `<section class="awards-simple-winners">
        ${category.winners.map((winner) => `<article class="awards-feature-winner">
            <img class="awards-feature-logo" src="${logoUrl(winner.teamId)}" alt="${escapeHtml(winner.team)}">
            <div><small>${escapeHtml(winner.honor || category.label)}</small><strong>${escapeHtml(winner.playerJa)}</strong><span>${escapeHtml(winner.team)}</span></div>
        </article>`).join("")}</section>`;

    const renderPending = (category) => `<section class="awards-pending"><span aria-hidden="true">AWARD</span>
        <h3>${escapeHtml(category.label)}</h3><p>${state.season}年の受賞者データはまだ登録されていません。</p></section>`;

    const sourceFooter = (category) => {
        const historicalUrl = majorHistoryData[state.season]?.[state.category]?.sourceUrl;
        const sourceUrl = state.season === 2026 ? (category.sourceUrl || "https://www.mlb.com/awards") : historicalUrl || "https://www.mlb.com/awards/gold-glove";
        return `<footer class="awards-source"><span>出典：MLB公式</span>
            <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">公式表彰ページを見る ↗</a></footer>`;
    };

    const render = () => {
        const category = categories[state.category];
        if (!category) return;
        const body = state.category === "goldGlove" ? (state.season === 2026 ? renderGoldGloveBody(category) : renderHistoricalGoldGlove())
            : ["mvp", "cyYoung", "rookie", "manager"].includes(state.category) && state.season !== 2026 ? renderHistoricalMajorPair()
            : state.category === "allMlb" && state.season !== 2026 ? renderHistoricalAllMlb()
            : state.season === 2026 && category.status === "announced" && Array.isArray(category.winners) ? renderSimpleWinners(category)
                : renderPending(category);
        content.innerHTML = `${hero(category)}${groupNav()}${categoryNav()}${body}${sourceFooter(category)}`;
    };

    content?.addEventListener("click", (event) => {
        const groupButton = event.target.closest("[data-award-group]");
        if (groupButton) {
            state.group = groupButton.dataset.awardGroup;
            state.category = categoryKeys(state.group)[0];
            render();
            return;
        }
        const categoryButton = event.target.closest("[data-award-category]");
        if (categoryButton) {
            state.category = categoryButton.dataset.awardCategory;
            render();
        }
    });

    content?.addEventListener("change", (event) => {
        if (!event.target.matches("#awards-season-select")) return;
        state.season = Number(event.target.value);
        const params = new URLSearchParams(location.hash.slice(1));
        params.set("view", "awards");
        params.set("season", String(state.season));
        history.replaceState(null, "", `#${params.toString()}`);
        render();
    });

    const open = () => { if (page) { page.hidden = false; render(); } };
    const close = () => { if (page) page.hidden = true; };
    window.Awards = { open, close, render };
})();
