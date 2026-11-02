(() => {
    "use strict";

    const page = document.getElementById("awards-page");
    const content = document.getElementById("awards-content");
    const data = window.MLB_AWARDS_2026 || {};

    const escapeHtml = (value) => String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const logoUrl = (teamId) => `https://www.mlbstatic.com/team-logos/${Number(teamId)}.svg`;

    const winnerCard = (winner, league) => `
        <article class="awards-winner-card awards-winner-${league.toLowerCase()}">
            <span class="awards-league-badge">${league}</span>
            <img class="awards-team-logo" src="${logoUrl(winner.teamId)}"
                alt="${escapeHtml(winner.team)}" loading="lazy">
            <div class="awards-winner-copy">
                <strong>${escapeHtml(winner.playerJa)}</strong>
                <small>${escapeHtml(winner.player)}</small>
            </div>
            <div class="awards-win-count">
                <b>${winner.count === 1 ? "初受賞" : `${winner.count}度目`}</b>
                <span>${escapeHtml(winner.team)}</span>
            </div>
        </article>`;

    const renderGoldGlove = () => {
        const award = data.categories?.goldGlove;
        if (!award) {
            content.innerHTML = '<p class="awards-empty">表彰データを準備しています。</p>';
            return;
        }
        const teamLeaders = award.summary.teamLeaders.map((row) => `
            <span class="awards-summary-team">
                <img src="${logoUrl(row.teamId)}" alt="${escapeHtml(row.team)}">
                <b>${row.count}人</b>
            </span>`).join("");

        content.innerHTML = `
            <section class="awards-hero">
                <div>
                    <span class="awards-kicker">2026 MLB AWARDS</span>
                    <h2>ゴールドグラブ賞</h2>
                    <p>各リーグ・各守備位置の最優秀守備選手</p>
                </div>
                <div class="awards-hero-meta">
                    <b>2026</b>
                    <span>11月1日発表</span>
                </div>
            </section>
            <nav class="awards-category-nav" aria-label="表彰カテゴリー">
                <button type="button" class="active">ゴールドグラブ</button>
                <button type="button" disabled>シルバースラッガー <small>発表待ち</small></button>
                <button type="button" disabled>MVP <small>発表待ち</small></button>
                <button type="button" disabled>サイ・ヤング賞 <small>発表待ち</small></button>
                <button type="button" disabled>新人王 <small>発表待ち</small></button>
                <button type="button" disabled>オールMLB <small>発表待ち</small></button>
            </nav>
            <section class="awards-summary" aria-label="2026年ゴールドグラブ概要">
                <div><small>受賞者</small><strong>${award.winners.length * 2}人</strong></div>
                <div><small>初受賞</small><strong>${award.summary.firstTimeWinners}人</strong></div>
                <div class="awards-summary-leaders"><small>球団最多</small>${teamLeaders}</div>
            </section>
            <div class="awards-comparison-head" aria-hidden="true">
                <span>守備位置</span><strong>AMERICAN LEAGUE</strong><strong>NATIONAL LEAGUE</strong>
            </div>
            <section class="awards-winners">
                ${award.winners.map((row) => `
                    <div class="awards-position-row">
                        <div class="awards-position"><b>${escapeHtml(row.position)}</b><span>${escapeHtml(row.positionJa)}</span></div>
                        ${winnerCard(row.al, "AL")}
                        ${winnerCard(row.nl, "NL")}
                    </div>`).join("")}
            </section>
            <footer class="awards-source">
                <span>出典：MLB公式</span>
                <a href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">2026年受賞者と解説を見る ↗</a>
            </footer>`;
    };

    const render = () => renderGoldGlove();

    const open = () => {
        if (!page) return;
        page.hidden = false;
        render();
    };

    const close = () => {
        if (page) page.hidden = true;
    };

    window.Awards = { open, close, render };
})();
