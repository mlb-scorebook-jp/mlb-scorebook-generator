"use strict";

(() => {
    const cache = new Map();
    let generation = 0;
    const text = (value) => String(value ?? "").trim();
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const normalizeNameKey = (value) => text(value).normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const displayName = (player) => {
        try { return NHK_PLAYER_NAMES?.[normalizeNameKey(player?.fullName)] || text(player?.fullName) || `選手ID ${player?.playerId}`; }
        catch { return text(player?.fullName) || `選手ID ${player?.playerId}`; }
    };
    const fetchOptional = async (url) => {
        try {
            const response = await fetch(url);
            return response.ok ? response.json() : null;
        } catch { return null; }
    };
    const loadScriptData = (url, key) => new Promise((resolve) => {
        const existing = window.MLBDailyCalendarData?.[key];
        if (existing) { resolve(existing); return; }
        const script = document.createElement("script");
        script.src = url; script.async = true;
        script.addEventListener("load", () => { script.remove(); resolve(window.MLBDailyCalendarData?.[key] ?? null); }, { once: true });
        script.addEventListener("error", () => { script.remove(); resolve(null); }, { once: true });
        document.head.append(script);
    });
    const loadDayData = async (kind, monthDay) => {
        const root = `data/${kind === "birthday" ? "birthday" : "on-this-day"}/by-day/${monthDay}`;
        if (location.protocol === "file:") return loadScriptData(`${root}.js`, `${kind}:${monthDay}`);
        return fetchOptional(`${root}.json`);
    };
    const load = (monthDay) => {
        if (!cache.has(monthDay)) cache.set(monthDay, Promise.all([
            loadDayData("birthday", monthDay),
            loadDayData("history", monthDay)
        ]).then(([birthday, history]) => ({ birthday, history })));
        return cache.get(monthDay);
    };
    const intervalAt = (player, date) => (player?.roster ?? []).filter((entry) =>
        text(entry.start) <= date && (!entry.end || text(entry.end) >= date)
    ).sort((left, right) => text(right.start).localeCompare(text(left.start)))[0] ?? null;
    const sumLines = (games, date) => {
        const hitting = { G: 0, PA: 0, AB: 0, R: 0, H: 0, doubles: 0, triples: 0,
            HR: 0, RBI: 0, BB: 0, HBP: 0, SO: 0, SB: 0, CS: 0, GIDP: 0, TB: 0, E: 0 };
        const pitching = { G: 0, GS: 0, W: 0, L: 0, SV: 0, outs: 0, H: 0, R: 0,
            ER: 0, BB: 0, HBP: 0, SO: 0, HR: 0, CG: 0, SHO: 0 };
        const highlights = [];
        (games ?? []).filter((game) => text(game.date) <= date).forEach((game) => {
            Object.keys(hitting).forEach((key) => { hitting[key] += number(game?.hitting?.[key]); });
            Object.keys(pitching).forEach((key) => { pitching[key] += number(game?.pitching?.[key]); });
            (game.highlights ?? []).forEach((label) => {
                if (!highlights.includes(label)) highlights.push(label);
            });
        });
        return { hitting, pitching, highlights };
    };
    const rate = (numerator, denominator, digits = 3) => denominator
        ? (numerator / denominator).toFixed(digits).replace(/^0/, "") : "-";
    const innings = (outs) => `${Math.floor(number(outs) / 3)}.${number(outs) % 3}`;
    const section = (title, className) => {
        const node = document.createElement("section");
        node.className = `daily-calendar-section ${className}`;
        const heading = document.createElement("h3"); heading.textContent = title;
        const content = document.createElement("div"); content.className = "daily-calendar-list";
        node.append(heading, content); return { node, content };
    };
    const empty = (message) => {
        const node = document.createElement("p"); node.className = "daily-calendar-empty";
        node.textContent = message; return node;
    };
    const renderBirthdayCard = (player, date, roster, statsRange) => {
        const card = document.createElement("article"); card.className = "daily-birthday-card";
        const header = document.createElement("div"); header.className = "daily-birthday-header";
        const name = document.createElement("strong"); name.textContent = displayName(player);
        const age = document.createElement("span"); age.textContent = `${number(date.slice(0, 4)) - number(player.birthDate.slice(0, 4))}歳`;
        const team = document.createElement("span"); team.className = "daily-birthday-team";
        team.textContent = roster.teamCode || roster.teamName || "所属不明";
        header.append(name, age, team);
        const totals = sumLines(player.birthdayGames, date);
        const blocks = document.createElement("div"); blocks.className = "daily-birthday-stats";
        if (totals.hitting.G) {
            const line = document.createElement("p");
            line.innerHTML = `<b>打撃</b>　誕生日出場 ${totals.hitting.G}試合　` +
                `${rate(totals.hitting.H, totals.hitting.AB)}（${totals.hitting.AB}-${totals.hitting.H}）　` +
                `${totals.hitting.HR}HR　${totals.hitting.RBI}打点`;
            blocks.append(line);
        }
        if (totals.pitching.G) {
            const era = totals.pitching.outs ? (totals.pitching.ER * 27 / totals.pitching.outs).toFixed(2) : "-";
            const whip = totals.pitching.outs ? ((totals.pitching.BB + totals.pitching.H) * 3 / totals.pitching.outs).toFixed(2) : "-";
            const line = document.createElement("p");
            line.innerHTML = `<b>投手</b>　誕生日登板 ${totals.pitching.G}試合　` +
                `${totals.pitching.W}勝${totals.pitching.L}敗 ${totals.pitching.SV}S　` +
                `${innings(totals.pitching.outs)}回　防御率 ${era}　${totals.pitching.SO}奪三振　WHIP ${whip}`;
            blocks.append(line);
        }
        if (!totals.hitting.G && !totals.pitching.G) blocks.append(empty("これまでの誕生日出場なし"));
        if (totals.highlights.length) {
            const badges = document.createElement("div"); badges.className = "daily-birthday-highlights";
            totals.highlights.forEach((label) => {
                const badge = document.createElement("span"); badge.textContent = label; badges.append(badge);
            });
            blocks.append(badges);
        }
        const cutoff = statsRange?.endDate && statsRange.endDate < date ? statsRange.endDate : date;
        const coverage = document.createElement("small");
        coverage.textContent = `通算集計：${number(statsRange?.start) || 1964}年〜${cutoff.replaceAll("-", "/")}（レギュラーシーズン）`;
        card.append(header, blocks, coverage); return card;
    };
    const renderHistoryCard = (event, date) => {
        const card = document.createElement("article"); card.className = "daily-history-card";
        const year = document.createElement("strong"); year.textContent = `${text(event.date).replaceAll("-", "/")}（${number(date.slice(0, 4)) - number(text(event.date).slice(0, 4))}年前）`;
        const summary = document.createElement("p");
        const subject = event.playerName
            ? `${event.playerName}${event.teamCode ? `（${event.teamCode}）` : ""}`
            : event.teamCode || "MLB";
        summary.textContent = `${subject}　${event.summary}`;
        card.append(year, summary);
        if (event.gamedayUrl) {
            const anchor = document.createElement("a"); anchor.href = event.gamedayUrl;
            anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.textContent = "Gameday";
            card.append(anchor);
        }
        return card;
    };
    const render = async (date) => {
        const root = document.getElementById("daily-calendar-features");
        if (!root || !/^\d{4}-\d{2}-\d{2}$/.test(text(date))) return;
        const currentGeneration = ++generation;
        root.hidden = false; root.replaceChildren(); root.setAttribute("aria-busy", "true");
        const monthDay = date.slice(5);
        if (monthDay < "03-18" || monthDay > "11-05") {
            root.removeAttribute("aria-busy"); return;
        }
        const data = await load(monthDay);
        if (currentGeneration !== generation) return;
        const birthday = section("BIRTHDAY", "daily-birthday-section");
        const activePlayers = (data.birthday?.players ?? []).map((player) => ({
            player, roster: intervalAt(player, date)
        })).filter((entry) => entry.roster).sort((left, right) =>
            (left.roster.teamCode || "").localeCompare(right.roster.teamCode || "", "en") ||
            displayName(left.player).localeCompare(displayName(right.player), "ja"));
        if (activePlayers.length) activePlayers.forEach(({ player, roster }) =>
            birthday.content.append(renderBirthdayCard(player, date, roster, data.birthday?.statsRange)));
        else birthday.content.append(empty("この日に誕生日を迎える現役MLB選手はいません"));
        root.append(birthday.node);

        const history = section("今日はこんな日", "daily-history-section");
        const events = (data.history?.events ?? []).filter((event) => text(event.date) < date);
        if (!events.length) history.content.append(empty("既存記録DBに表示対象の出来事はありません"));
        else {
            const initial = 10;
            events.forEach((event, index) => {
                const card = renderHistoryCard(event, date);
                if (index >= initial) card.hidden = true;
                history.content.append(card);
            });
            if (events.length > initial) {
                const more = document.createElement("button"); more.type = "button";
                more.className = "daily-calendar-more"; more.textContent = `もっと見る（残り${events.length - initial}件）`;
                more.addEventListener("click", () => {
                    history.content.querySelectorAll(".daily-history-card[hidden]").forEach((card) => { card.hidden = false; });
                    more.remove();
                }, { once: true });
                history.content.append(more);
            }
        }
        root.append(history.node); root.removeAttribute("aria-busy");
    };
    const hide = () => {
        generation += 1;
        const root = document.getElementById("daily-calendar-features");
        if (root) root.hidden = true;
    };
    window.DailyCalendarFeatures = Object.freeze({ render, hide });
})();
