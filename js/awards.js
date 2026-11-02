(() => {
    "use strict";

    const page = document.getElementById("awards-page");
    const content = document.getElementById("awards-content");
    const data = window.MLB_AWARDS_2026 || {};
    const categories = data.categories || {};
    const groups = [
        { key: "major", label: "主要表彰" },
        { key: "battingDefense", label: "打撃・守備" },
        { key: "special", label: "特別表彰" },
        { key: "postseason", label: "大会MVP" }
    ];
    const state = { group: "battingDefense", category: "goldGlove" };

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
    const metricKeys = ["FRV", "DRS", "OAA"];
    const metricValues = (winner) => {
        const values = Object.fromEntries((winner.metrics || []).map((metric) => [metric.label, metric.value]));
        return metricKeys.map((key) => `<b title="${key}">${escapeHtml(values[key] || "—")}</b>`).join("");
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
                return `<button type="button" data-award-category="${key}"
                    class="${state.category === key ? "active" : ""}">${escapeHtml(category.label)}
                    <small>${category.status === "announced" ? "発表済み" : "発表待ち"}</small></button>`;
            }).join("")}
        </nav>`;

    const hero = (category) => `
        <section class="awards-hero">
            <div><span class="awards-kicker">2026 MLB AWARDS</span><h2>${escapeHtml(category.label)}</h2>
                <p>${escapeHtml(category.description || "2026年シーズンの主要表彰")}</p></div>
            <div class="awards-hero-meta"><b>2026</b><span>${category.status === "announced" ? "発表済み" : "発表待ち"}</span></div>
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
                <div class="awards-league-head"><strong>AMERICAN LEAGUE</strong><div>${metricKeys.map((key) => `<b>${key}</b>`).join("")}</div></div>
                <div class="awards-league-head"><strong>NATIONAL LEAGUE</strong><div>${metricKeys.map((key) => `<b>${key}</b>`).join("")}</div></div>
            </div>
            <section class="awards-winners">${award.winners.map((row) => `<div class="awards-position-row">
                <div class="awards-position"><b>${escapeHtml(row.position)}</b><span>${escapeHtml(row.positionJa)}</span></div>
                ${winnerCard(row.al, "AL")}${winnerCard(row.nl, "NL")}</div>`).join("")}</section>`;
    };

    const renderSimpleWinners = (category) => `<section class="awards-simple-winners">
        ${category.winners.map((winner) => `<article class="awards-feature-winner">
            <img class="awards-feature-logo" src="${logoUrl(winner.teamId)}" alt="${escapeHtml(winner.team)}">
            <div><small>${escapeHtml(winner.honor || category.label)}</small><strong>${escapeHtml(winner.playerJa)}</strong><span>${escapeHtml(winner.team)}</span></div>
        </article>`).join("")}</section>`;

    const renderPending = (category) => `<section class="awards-pending"><span aria-hidden="true">AWARD</span>
        <h3>${escapeHtml(category.label)}</h3><p>2026年の受賞者はまだ発表されていません。公式発表後に追加します。</p></section>`;

    const sourceFooter = (category) => `<footer class="awards-source"><span>出典：MLB公式</span>
        <a href="${escapeHtml(category.sourceUrl || "https://www.mlb.com/awards")}" target="_blank" rel="noopener noreferrer">公式表彰ページを見る ↗</a></footer>`;

    const render = () => {
        const category = categories[state.category];
        if (!category) return;
        const body = state.category === "goldGlove" ? renderGoldGloveBody(category)
            : category.status === "announced" && Array.isArray(category.winners) ? renderSimpleWinners(category)
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

    const open = () => { if (page) { page.hidden = false; render(); } };
    const close = () => { if (page) page.hidden = true; };
    window.Awards = { open, close, render };
})();
