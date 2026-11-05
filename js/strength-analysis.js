(function (global) {
    "use strict";

    const SEASON = 2026;
    const page = document.getElementById("strength-analysis-page");
    const root = document.getElementById("strength-analysis-content");
    const cache = new Map();
    let teamComparisonPromise = null;
    let pitchingComparisonPromise = null;
    let teams = [];
    let selectedTeamId = 119;

    const el = (tag, className = "", text = "") => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== "") node.textContent = text;
        return node;
    };
    const number = (value) => Number(value) || 0;
    const rate = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
    const normalize = (value, low, high, inverse = false) => {
        const score = ((value - low) / (high - low)) * 100;
        return clamp(inverse ? 100 - score : score);
    };
    const displayRate = (value) => {
        const parsed = rate(value);
        return parsed.toFixed(3).replace(/^0/, "");
    };
    const logoUrl = (teamId) => `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
    const nameKey = (value) => String(value || "").normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const japanesePlayerName = (name) => {
        const translated = typeof NHK_PLAYER_NAMES !== "undefined" ? NHK_PLAYER_NAMES[nameKey(name)] : "";
        return translated && translated !== "表記待ち" ? translated : name;
    };
    const japaneseTeamName = (team) => {
        const translated = global.MLB_TEAM_NAMES_JA?.[nameKey(team?.name)] || "";
        return translated || team?.name || "MLB球団";
    };
    const japaneseLeagueName = (team) => {
        const league = Number(team?.league?.id) === 103 ? "アメリカンリーグ" : "ナショナルリーグ";
        const divisionNames = { 200: "西地区", 201: "東地区", 202: "中地区", 203: "西地区", 204: "東地区", 205: "中地区" };
        return `${league} ${divisionNames[Number(team?.division?.id)] || ""}`.trim();
    };
    const faIds = () => new Set((global.MLB_FREE_AGENT_CANDIDATES?.[SEASON] || [])
        .map((entry) => Number(entry.playerId)));

    const fetchJson = async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`MLB API ${response.status}`);
        return response.json();
    };

    const loadTeams = async () => {
        if (teams.length) return teams;
        const payload = await fetchJson(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${SEASON}`);
        teams = (payload.teams || []).sort((a, b) => {
            const league = String(a.league?.name || "").localeCompare(String(b.league?.name || ""));
            return league || String(a.division?.name || "").localeCompare(String(b.division?.name || "")) ||
                String(a.name).localeCompare(String(b.name));
        });
        return teams;
    };

    const loadGroup = async (teamId, group) => {
        const params = new URLSearchParams({
            stats: "season", group, season: String(SEASON), teamId: String(teamId),
            playerPool: "ALL", gameType: "R", limit: "100", hydrate: "person"
        });
        const payload = await fetchJson(`https://statsapi.mlb.com/api/v1/stats?${params}`);
        return (payload.stats || []).flatMap((entry) => entry.splits || []).map((split) => ({
            id: Number(split.player?.id),
            name: split.player?.fullName || "—",
            position: split.position?.abbreviation || split.player?.primaryPosition?.abbreviation || "—",
            stat: split.stat || {}
        }));
    };

    const loadTeam = async (teamId) => {
        if (!cache.has(teamId)) {
            cache.set(teamId, Promise.all([loadGroup(teamId, "hitting"), loadGroup(teamId, "pitching")])
                .then(([hitters, pitchers]) => ({
                    hitters: hitters.filter((row) => !["P", "SP", "RP"].includes(row.position)),
                    pitchers: pitchers.filter((row) => ["P", "SP", "RP", "TWP"].includes(row.position))
                })));
        }
        return cache.get(teamId);
    };

    const sum = (rows, field) => rows.reduce((total, row) => total + number(row.stat[field]), 0);
    const loadTeamComparisons = async () => {
        if (!teamComparisonPromise) {
            const base = `stats=season&season=${SEASON}&sportIds=1&gameType=R`;
            teamComparisonPromise = Promise.all([
                fetchJson(`https://statsapi.mlb.com/api/v1/teams/stats?${base}&group=hitting`),
                fetchJson(`https://statsapi.mlb.com/api/v1/teams/stats?${base}&group=fielding`)
            ]).then(([hittingPayload, fieldingPayload]) => {
                const hitting = new Map((hittingPayload.stats || []).flatMap((entry) => entry.splits || [])
                    .map((split) => [Number(split.team?.id), split.stat || {}]));
                const fielding = new Map((fieldingPayload.stats || []).flatMap((entry) => entry.splits || [])
                    .map((split) => [Number(split.team?.id), split.stat || {}]));
                return teams.map((team) => {
                    const stat = hitting.get(Number(team.id)) || {};
                    const defense = fielding.get(Number(team.id)) || {};
                    const games = number(stat.gamesPlayed) || 1;
                    const plateAppearances = number(stat.plateAppearances) || 1;
                    return {
                        teamId: Number(team.id),
                        power: rate(stat.slg) - rate(stat.avg),
                        contact: rate(stat.avg),
                        defense: rate(defense.fielding),
                        scoring: number(stat.runs) / games,
                        discipline: number(stat.baseOnBalls) / plateAppearances,
                        speed: (number(stat.stolenBases) - (number(stat.caughtStealing) * .5)) / games
                    };
                });
            });
        }
        return teamComparisonPromise;
    };

    const computeHittingRatings = async (teamId) => {
        const comparisons = await loadTeamComparisons();
        const definitions = [
            { key: "power", label: "パワー", format: (value) => `ISO ${displayRate(value)}` },
            { key: "contact", label: "ミート", format: (value) => `打率 ${displayRate(value)}` },
            { key: "defense", label: "守備力", format: (value) => `守備率 ${displayRate(value)}` },
            { key: "scoring", label: "得点力", format: (value) => `1試合 ${value.toFixed(2)}得点` },
            { key: "discipline", label: "選球眼", format: (value) => `四球率 ${(value * 100).toFixed(1)}%` },
            { key: "speed", label: "走力", format: (value) => `走塁指数 ${value.toFixed(2)}` }
        ];
        return definitions.map((definition) => {
            const ranked = [...comparisons].sort((a, b) => b[definition.key] - a[definition.key]);
            const rank = ranked.findIndex((entry) => entry.teamId === Number(teamId)) + 1;
            const selected = ranked.find((entry) => entry.teamId === Number(teamId));
            const score = clamp(100 - ((Math.max(1, rank) - 1) * (75 / 29)));
            return {
                label: definition.label,
                score,
                rank,
                displayScore: `${rank}位`,
                detail: `${definition.format(selected?.[definition.key] || 0)}・30球団中${rank}位`
            };
        });
    };

    const loadTeamFastballVelocity = async (teamId) => {
        const params = new URLSearchParams({
            stats: "metricAverages", group: "pitching", season: String(SEASON),
            teamId: String(teamId), metrics: "releaseSpeed", gameType: "R", limit: "1000"
        });
        const payload = await fetchJson(`https://statsapi.mlb.com/api/v1/stats?${params}`);
        const fastballs = (payload.stats || []).flatMap((entry) => entry.splits || []).filter((split) =>
            ["FF", "SI", "FC"].includes(split.stat?.event?.details?.type?.code));
        const pitchCount = fastballs.reduce((total, split) => total + number(split.numOccurrences), 0);
        return pitchCount ? fastballs.reduce((total, split) =>
            total + (number(split.stat?.metric?.averageValue) * number(split.numOccurrences)), 0) / pitchCount : 0;
    };

    const loadPitchingComparisons = async () => {
        if (!pitchingComparisonPromise) {
            const params = new URLSearchParams({
                stats: "season", group: "pitching", season: String(SEASON), sportIds: "1", gameType: "R"
            });
            pitchingComparisonPromise = Promise.all([
                fetchJson(`https://statsapi.mlb.com/api/v1/teams/stats?${params}`),
                Promise.all(teams.map(async (team) => [Number(team.id), await loadTeamFastballVelocity(team.id)]))
            ]).then(([payload, velocityEntries]) => {
                const velocities = new Map(velocityEntries);
                return (payload.stats || []).flatMap((entry) => entry.splits || []).map((split) => {
                    const stat = split.stat || {};
                    const games = number(stat.gamesPlayed) || 1;
                    const saveOpportunities = number(stat.saveOpportunities);
                    const baserunners = number(stat.hits) + number(stat.baseOnBalls) + number(stat.hitBatsmen);
                    const strandDenominator = Math.max(1, baserunners - number(stat.homeRuns));
                    const strandRate = 1 - (Math.max(0, number(stat.runs) - number(stat.homeRuns)) / strandDenominator);
                    const saveRate = saveOpportunities ? number(stat.saves) / saveOpportunities : 0;
                    return {
                        teamId: Number(split.team?.id),
                        velocity: velocities.get(Number(split.team?.id)) || 0,
                        control: -number(stat.walksPer9Inn),
                        stamina: -number(stat.pitchesPerInning),
                        strikeouts: number(stat.strikeoutsPer9Inn),
                        clutch: strandRate,
                        bullpen: saveRate + ((number(stat.holds) / games) * .25),
                        bb9: number(stat.walksPer9Inn),
                        pitchesPerInning: number(stat.pitchesPerInning),
                        k9: number(stat.strikeoutsPer9Inn),
                        strandRate,
                        saveRate,
                        holds: number(stat.holds)
                    };
                });
            });
        }
        return pitchingComparisonPromise;
    };

    const computePitchingRatings = async (teamId) => {
        const comparisons = await loadPitchingComparisons();
        const definitions = [
            { key: "velocity", label: "球速", format: (entry) => `平均 ${entry.velocity.toFixed(1)}mph` },
            { key: "control", label: "制球力", format: (entry) => `BB/9 ${entry.bb9.toFixed(2)}` },
            { key: "stamina", label: "スタミナ", format: (entry) => `1回 ${entry.pitchesPerInning.toFixed(2)}球` },
            { key: "strikeouts", label: "奪三振", format: (entry) => `K/9 ${entry.k9.toFixed(2)}` },
            { key: "clutch", label: "ピンチ", format: (entry) => `推定残塁率 ${(entry.strandRate * 100).toFixed(1)}%` },
            { key: "bullpen", label: "ブルペン", format: (entry) => `セーブ成功率 ${(entry.saveRate * 100).toFixed(1)}%・${entry.holds}H` }
        ];
        return definitions.map((definition) => {
            const ranked = [...comparisons].sort((a, b) => b[definition.key] - a[definition.key]);
            const rank = ranked.findIndex((entry) => entry.teamId === Number(teamId)) + 1;
            const selected = ranked.find((entry) => entry.teamId === Number(teamId)) || {};
            return {
                label: definition.label,
                score: clamp(100 - ((Math.max(1, rank) - 1) * (75 / 29))),
                rank,
                displayScore: `${rank}位`,
                detail: `${definition.format(selected)}・30球団中${rank}位`
            };
        });
    };

    const polygonPoints = (values, radius, center = 160) => values.map((value, index) => {
        const angle = (-Math.PI / 2) + (index * Math.PI * 2 / values.length);
        const distance = radius * value;
        return `${center + Math.cos(angle) * distance},${center + Math.sin(angle) * distance}`;
    }).join(" ");

    const renderRadar = (ratings) => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 320 320");
        svg.classList.add("strength-radar");
        [1, .8, .6, .4, .2].forEach((level) => {
            const polygon = document.createElementNS(svg.namespaceURI, "polygon");
            polygon.setAttribute("points", polygonPoints(ratings.map(() => level), 112));
            polygon.setAttribute("class", "strength-radar-grid");
            svg.append(polygon);
        });
        ratings.forEach((rating, index) => {
            const angle = (-Math.PI / 2) + (index * Math.PI * 2 / ratings.length);
            const axis = document.createElementNS(svg.namespaceURI, "line");
            axis.setAttribute("x1", "160"); axis.setAttribute("y1", "160");
            axis.setAttribute("x2", String(160 + Math.cos(angle) * 112));
            axis.setAttribute("y2", String(160 + Math.sin(angle) * 112));
            axis.setAttribute("class", "strength-radar-axis");
            svg.append(axis);
        });
        const shape = document.createElementNS(svg.namespaceURI, "polygon");
        shape.setAttribute("points", polygonPoints(ratings.map((item) => item.score / 100), 112));
        shape.setAttribute("class", "strength-radar-shape");
        svg.append(shape);
        ratings.forEach((rating, index) => {
            const angle = (-Math.PI / 2) + (index * Math.PI * 2 / ratings.length);
            const pointDistance = 112 * rating.score / 100;
            const point = document.createElementNS(svg.namespaceURI, "circle");
            point.setAttribute("cx", String(160 + Math.cos(angle) * pointDistance));
            point.setAttribute("cy", String(160 + Math.sin(angle) * pointDistance));
            point.setAttribute("r", "3.5"); point.setAttribute("class", "strength-radar-point");
            svg.append(point);
            const label = document.createElementNS(svg.namespaceURI, "text");
            label.setAttribute("x", String(160 + Math.cos(angle) * 142));
            label.setAttribute("y", String(160 + Math.sin(angle) * 136));
            label.setAttribute("class", "strength-radar-label");
            label.textContent = rating.label;
            svg.append(label);
            const score = document.createElementNS(svg.namespaceURI, "text");
            score.setAttribute("x", String(160 + Math.cos(angle) * 142));
            score.setAttribute("y", String(174 + Math.sin(angle) * 136));
            score.setAttribute("class", "strength-radar-score");
            score.textContent = rating.displayScore || String(rating.score);
            svg.append(score);
        });
        return svg;
    };

    const playerCell = (row, freeAgents) => {
        const wrap = el("div", "strength-player");
        wrap.append(el("span", "", japanesePlayerName(row.name)), el("span", "strength-position", row.position));
        if (freeAgents.has(row.id)) wrap.append(el("span", "strength-fa", "FA"));
        return wrap;
    };

    const renderTable = (title, rows, type, freeAgents) => {
        const panel = el("section", "strength-panel");
        panel.append(el("h3", "strength-panel-title", `${title}（${rows.length}人）`));
        if (!rows.length) { panel.append(el("div", "strength-empty", "成績データがありません")); return panel; }
        const scroll = el("div", "strength-table-scroll");
        const table = el("table", "strength-table");
        const fields = type === "hitting"
            ? [["選手", null], ["試合", "gamesPlayed"], ["打率", "avg"], ["本塁打", "homeRuns"], ["打点", "rbi"], ["盗塁", "stolenBases"], ["四球", "baseOnBalls"], ["三振", "strikeOuts"]]
            : [["選手", null], ["試合", "gamesPlayed"], ["勝", "wins"], ["敗", "losses"], ["防御率", "era"], ["投球回", "inningsPitched"], ["奪三振", "strikeOuts"], ["WHIP", "whip"]];
        const thead = el("thead"); const header = el("tr");
        fields.forEach(([label]) => header.append(el("th", "", label)));
        thead.append(header); table.append(thead);
        const tbody = el("tbody");
        rows.sort((a, b) => number(b.stat.gamesPlayed) - number(a.stat.gamesPlayed)).forEach((row) => {
            const tr = el("tr");
            fields.forEach(([, field], index) => {
                const td = el("td");
                if (!index) td.append(playerCell(row, freeAgents));
                else td.textContent = row.stat[field] ?? "—";
                tr.append(td);
            });
            tbody.append(tr);
        });
        table.append(tbody); scroll.append(table); panel.append(scroll);
        return panel;
    };

    const saveSelection = () => global.MLBAppSession?.save({
        view: "strength-analysis", season: SEASON, team: selectedTeamId
    });

    const renderTeam = async (teamId) => {
        selectedTeamId = Number(teamId);
        const body = root.querySelector(".strength-body");
        body.replaceChildren(el("div", "strength-loading", "MLB公式のシーズン成績を読み込んでいます…"));
        saveSelection();
        try {
            const [{ hitters, pitchers }, hittingRatings, pitchingRatings] = await Promise.all([
                loadTeam(selectedTeamId), computeHittingRatings(selectedTeamId), computePitchingRatings(selectedTeamId)
            ]);
            if (selectedTeamId !== Number(teamId)) return;
            const team = teams.find((entry) => Number(entry.id) === selectedTeamId) || {};
            const freeAgents = faIds();
            const teamHeader = el("section", "strength-team-header");
            const logo = document.createElement("img"); logo.src = logoUrl(selectedTeamId); logo.alt = "";
            const teamCopy = el("div");
            teamCopy.append(el("h3", "", japaneseTeamName(team)),
                el("p", "", `${japaneseLeagueName(team)}　${SEASON}年レギュラーシーズン`));
            teamHeader.append(logo, teamCopy);
            const overview = el("div", "strength-overview");
            const hittingRadarPanel = el("section", "strength-panel");
            hittingRadarPanel.append(el("h3", "strength-panel-title", "野手能力チャート"));
            const hittingRadarWrap = el("div", "strength-radar-wrap");
            hittingRadarWrap.append(renderRadar(hittingRatings)); hittingRadarPanel.append(hittingRadarWrap);
            const pitchingRadarPanel = el("section", "strength-panel");
            pitchingRadarPanel.append(el("h3", "strength-panel-title", "投手能力チャート"));
            const pitchingRadarWrap = el("div", "strength-radar-wrap");
            pitchingRadarWrap.append(renderRadar(pitchingRatings)); pitchingRadarPanel.append(pitchingRadarWrap);
            overview.append(hittingRadarPanel, pitchingRadarPanel);
            const notesPanel = el("section", "strength-panel strength-notes-panel");
            notesPanel.append(el("h3", "strength-panel-title", "成績から見た補強ポイント"));
            const notes = el("div", "strength-notes");
            const weakest = [
                ...[...hittingRatings].sort((a, b) => a.score - b.score).slice(0, 2)
                    .map((rating) => ({ ...rating, group: "野手" })),
                ...[...pitchingRatings].sort((a, b) => a.score - b.score).slice(0, 2)
                    .map((rating) => ({ ...rating, group: "投手" }))
            ];
            weakest.forEach((rating) => {
                const note = el("div", "strength-note is-weak");
                note.append(el("strong", "", `${rating.group}｜${rating.label}　${rating.displayScore || rating.score}`),
                    el("span", "", `${rating.detail}。オフの優先補強項目。`));
                notes.append(note);
            });
            notesPanel.append(notes);
            const rosters = el("div", "strength-rosters");
            rosters.append(renderTable("野手成績", hitters, "hitting", freeAgents),
                renderTable("投手成績", pitchers, "pitching", freeAgents));
            body.replaceChildren(teamHeader, overview, notesPanel, rosters,
                el("p", "strength-source", "成績：MLB Stats API　FA表示：MLB公式FA候補リスト"));
        } catch (error) {
            console.error(error);
            body.replaceChildren(el("div", "strength-error", "成績を取得できませんでした。通信状態を確認して、球団を選び直してください。"));
        }
    };

    const build = async (options = {}) => {
        root.replaceChildren();
        const hero = el("header", "strength-hero");
        const intro = el("div");
        intro.append(el("span", "strength-kicker", "TEAM STRENGTH ANALYSIS"),
            el("h2", "", "戦力分析"), el("p", "", "2026年成績から、30球団の現在地とオフの補強ポイントを確認"));
        const selector = el("div", "strength-selector");
        const label = el("label"); label.append(el("span", "", "球団選択"));
        const picker = el("div", "strength-team-picker");
        const pickerButton = el("button", "strength-team-picker-button");
        pickerButton.type = "button";
        pickerButton.setAttribute("aria-label", "分析する球団");
        pickerButton.setAttribute("aria-haspopup", "listbox");
        pickerButton.setAttribute("aria-expanded", "false");
        const pickerMenu = el("div", "strength-team-picker-menu");
        pickerMenu.setAttribute("role", "listbox");
        pickerMenu.hidden = true;
        picker.append(pickerButton, pickerMenu); label.append(picker); selector.append(label); hero.append(intro, selector);
        const body = el("div", "strength-body");
        root.append(hero, body);
        try {
            await loadTeams();
            const requested = Number(options.team);
            selectedTeamId = teams.some((team) => Number(team.id) === requested) ? requested : selectedTeamId;
            const renderPickerButton = () => {
                const selected = teams.find((team) => Number(team.id) === selectedTeamId) || teams[0];
                const image = document.createElement("img"); image.src = logoUrl(selected.id); image.alt = "";
                pickerButton.replaceChildren(image, el("span", "", japaneseTeamName(selected)), el("span", "strength-team-picker-arrow", "⌄"));
            };
            teams.forEach((team) => {
                const option = el("button", "strength-team-picker-option");
                option.type = "button"; option.setAttribute("role", "option");
                option.dataset.teamId = String(team.id);
                const image = document.createElement("img"); image.src = logoUrl(team.id); image.alt = "";
                option.append(image, el("span", "", japaneseTeamName(team)));
                option.addEventListener("click", () => {
                    selectedTeamId = Number(team.id);
                    pickerMenu.hidden = true;
                    pickerButton.setAttribute("aria-expanded", "false");
                    pickerMenu.querySelectorAll("[role='option']").forEach((item) =>
                        item.setAttribute("aria-selected", String(Number(item.dataset.teamId) === selectedTeamId)));
                    renderPickerButton();
                    renderTeam(selectedTeamId);
                });
                pickerMenu.append(option);
            });
            pickerButton.addEventListener("click", () => {
                const open = pickerMenu.hidden;
                pickerMenu.hidden = !open;
                pickerButton.setAttribute("aria-expanded", String(open));
            });
            document.addEventListener("click", (event) => {
                if (picker.contains(event.target)) return;
                pickerMenu.hidden = true;
                pickerButton.setAttribute("aria-expanded", "false");
            }, { signal: AbortSignal.timeout(12 * 60 * 60 * 1000) });
            renderPickerButton();
            pickerMenu.querySelectorAll("[role='option']").forEach((item) =>
                item.setAttribute("aria-selected", String(Number(item.dataset.teamId) === selectedTeamId)));
            await renderTeam(selectedTeamId);
        } catch (error) {
            console.error(error);
            body.replaceChildren(el("div", "strength-error", "MLB球団データを取得できませんでした。"));
        }
    };

    global.StrengthAnalysis = {
        open(options = {}) { page.hidden = false; build(options); },
        close() { page.hidden = true; }
    };
})(window);
