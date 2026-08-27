"use strict";

(() => {
    document.documentElement.classList.toggle("pregame-touch-capable", navigator.maxTouchPoints > 0);

    const API_ROOT = "https://statsapi.mlb.com/api";
    const cache = new Map();
    const savantCache = new Map();
    const gameIndex = new Map();
    let currentContext = null;
    let currentDate = "";
    let currentPlayerView = null;

    const dom = {};
    let headerActionsAnchor = null;

    const scrollPregameToTop = () => {
        const reset = () => {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            [document.querySelector(".app-main"), dom.viewer, dom.view]
                .filter(Boolean)
                .forEach((node) => {
                    node.scrollLeft = 0;
                    node.scrollTop = 0;
                });
        };
        reset();
        requestAnimationFrame(reset);
    };

    const placeHeaderActions = (inAppHeader = false) => {
        if (!dom.headerActions || !dom.appHeader || !headerActionsAnchor) return;
        if (inAppHeader) {
            dom.appHeader.append(dom.headerActions);
            dom.headerActions.classList.add("pregame-header-actions-global");
            document.body.classList.add("pregame-game-detail-active");
            return;
        }
        headerActionsAnchor.after(dom.headerActions);
        dom.headerActions.classList.remove("pregame-header-actions-global");
        document.body.classList.remove("pregame-game-detail-active");
    };

    const savePregameSession = (view, details = {}) => {
        window.MLBAppSession?.save?.({
            view,
            date: currentDate || currentMlbDate(),
            ...details
        });
    };

    const el = (tag, className = "", text = "") => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== "") node.textContent = text;
        return node;
    };

    const fetchJson = async (url, cacheKey = url) => {
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const request = fetch(url).then(async (response) => {
            if (!response.ok) throw new Error(`MLB公式データを取得できませんでした（${response.status}）`);
            return response.json();
        });
        cache.set(cacheKey, request);
        return request;
    };

    const parseCsvLine = (line) => {
        const values = [];
        let value = "";
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            if (character === '"') {
                if (quoted && line[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (character === "," && !quoted) {
                values.push(value);
                value = "";
            } else {
                value += character;
            }
        }
        values.push(value);
        return values;
    };

    const savantPlayerUrl = (person, view = "hitting") => {
        const id = Number(person?.id);
        if (!id) return "";
        const slug = String(person?.fullName ?? person?.name ?? "player")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/['’]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "player";
        const statsView = view === "zones" ? "statcast-r-zones-mlb" : "statcast-r-hitting-mlb";
        return `https://baseballsavant.mlb.com/savant-player/${slug}-${id}?stats=${statsView}`;
    };

    const getSavantHittingMetrics = async (playerId, season, beforeDate = "") => {
        if (beforeDate && Number(String(beforeDate).slice(0, 4)) === Number(season)) {
            const rows = await getSavantBattedBallRows(playerId, season, beforeDate);
            const battedBalls = rows.filter((row) =>
                String(row.launch_speed ?? "").trim() !== "" &&
                String(row.launch_speed_angle ?? "").trim() !== "" &&
                Number.isFinite(Number(row.launch_speed))
            );
            if (!battedBalls.length) return null;
            const barrels = battedBalls.filter((row) => Number(row.launch_speed_angle) === 6).length;
            const hardHit = battedBalls.filter((row) => Number(row.launch_speed) >= 95).length;
            const averageExitVelocity = battedBalls.reduce(
                (sum, row) => sum + Number(row.launch_speed), 0
            ) / battedBalls.length;
            const distances = battedBalls
                .filter((row) => String(row.hit_distance_sc ?? "").trim() !== "")
                .map((row) => Number(row.hit_distance_sc))
                .filter(Number.isFinite);
            const compact = (value) => value.toFixed(1).replace(/\.0$/, "");
            return {
                brl_percent: compact((barrels * 100) / battedBalls.length),
                avg_hit_speed: compact(averageExitVelocity),
                ev95percent: compact((hardHit * 100) / battedBalls.length),
                max_distance: distances.length ? String(Math.round(Math.max(...distances))) : ""
            };
        }
        const key = `savant:statcast:${season}`;
        if (!savantCache.has(key)) {
            const params = new URLSearchParams({
                type: "batter",
                year: String(season),
                position: "",
                team: "",
                min: "1",
                sort: "barrel_batted_rate",
                sortDir: "desc",
                csv: "true"
            });
            const request = fetch(`https://baseballsavant.mlb.com/leaderboard/statcast?${params}`)
                .then(async (response) => {
                    if (!response.ok) throw new Error(`Baseball Savantを取得できませんでした（${response.status}）`);
                    const lines = (await response.text()).replace(/^\uFEFF/, "")
                        .split(/\r?\n/)
                        .filter(Boolean);
                    if (!lines.length) return new Map();
                    const headers = parseCsvLine(lines[0]);
                    return new Map(lines.slice(1).map((line) => {
                        const values = parseCsvLine(line);
                        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
                        return [Number(row.player_id), row];
                    }).filter(([id]) => Number.isFinite(id)));
                });
            savantCache.set(key, request);
        }
        const players = await savantCache.get(key);
        return players.get(Number(playerId)) ?? null;
    };

    const SAVANT_HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
    const SAVANT_AT_BAT_EVENTS = new Set([
        "single",
        "double",
        "triple",
        "home_run",
        "field_out",
        "force_out",
        "grounded_into_double_play",
        "fielders_choice",
        "fielders_choice_out",
        "strikeout",
        "strikeout_double_play",
        "double_play",
        "triple_play",
        "field_error",
        "other_out"
    ]);

    const getSavantBattedBallRows = async (playerId, season, beforeDate) => {
        const endDate = previousDate(beforeDate);
        const key = `savant:player-rows:${playerId}:${season}:${endDate}`;
        if (!savantCache.has(key)) {
            const params = new URLSearchParams({
                all: "true",
                type: "batter",
                player_type: "batter",
                hfSea: `${season}|`,
                hfGT: "R|",
                game_date_gt: `${season}-01-01`,
                game_date_lt: endDate
            });
            params.append("batters_lookup[]", String(playerId));
            const request = fetch(`https://baseballsavant.mlb.com/statcast_search/csv?${params}`)
                .then(async (response) => {
                    if (!response.ok) throw new Error(`Baseball Savantを取得できませんでした（${response.status}）`);
                    const lines = (await response.text()).replace(/^\uFEFF/, "")
                        .split(/\r?\n/)
                        .filter(Boolean);
                    if (!lines.length) return [];
                    const headers = parseCsvLine(lines[0]);
                    return lines.slice(1).map((line) => {
                        const values = parseCsvLine(line);
                        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
                    });
                });
            savantCache.set(key, request);
        }
        return savantCache.get(key);
    };

    const getSavantZoneBattingAverage = async (playerId, season, beforeDate) => {
        const endDate = previousDate(beforeDate);
        const key = `savant:zones:${playerId}:${season}:${endDate}`;
        if (!savantCache.has(key)) {
            const request = getSavantBattedBallRows(playerId, season, beforeDate)
                .then((rows) => {
                    const totals = new Map();
                    rows.forEach((row) => {
                        const event = row.events;
                        const zone = Number(row.zone);
                        if (!SAVANT_AT_BAT_EVENTS.has(event) || !Number.isInteger(zone) || zone === 10 || zone < 1 || zone > 14) return;
                        const current = totals.get(zone) ?? { atBats: 0, hits: 0 };
                        current.atBats += 1;
                        if (SAVANT_HIT_EVENTS.has(event)) current.hits += 1;
                        totals.set(zone, current);
                    });
                    return new Map([...totals.entries()].map(([zone, total]) => [
                        zone,
                        total.atBats ? total.hits / total.atBats : null
                    ]));
                });
            savantCache.set(key, request);
        }
        return savantCache.get(key);
    };

    const SAVANT_PITCH_SWING_DESCRIPTIONS = new Set([
        "swinging_strike",
        "swinging_strike_blocked",
        "missed_bunt",
        "foul_tip",
        "foul",
        "foul_bunt",
        "hit_into_play"
    ]);
    const SAVANT_PITCH_WHIFF_DESCRIPTIONS = new Set([
        "swinging_strike",
        "swinging_strike_blocked",
        "missed_bunt",
        "foul_tip"
    ]);
    const SAVANT_PITCH_TYPE_LABELS = new Map([
        ["FF", "4シーム"],
        ["SI", "シンカー"],
        ["FC", "カッター"],
        ["SL", "スライダー"],
        ["ST", "スイーパー"],
        ["CU", "カーブ"],
        ["CS", "スローカーブ"],
        ["KC", "ナックルカーブ"],
        ["CH", "チェンジアップ"],
        ["FS", "スプリット"],
        ["FO", "フォーク"],
        ["SC", "スクリュー"],
        ["KN", "ナックル"],
        ["EP", "イーファス"],
        ["SV", "スラーブ"]
    ]);

    const savantPitcherUrl = (person, view = "pitching") => {
        const id = Number(person?.id);
        if (!id) return "";
        const slug = String(person?.fullName ?? person?.name ?? "player")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/['’]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "player";
        const statsView = view === "zones" ? "statcast-r-zones-mlb" : "statcast-r-pitching-mlb";
        return `https://baseballsavant.mlb.com/savant-player/${slug}-${id}?stats=${statsView}`;
    };

    const getSavantPitchRows = async (playerId, season, beforeDate) => {
        const endDate = previousDate(beforeDate);
        const key = `savant:pitcher:player-rows:${playerId}:${season}:${endDate}`;
        if (!savantCache.has(key)) {
            const params = new URLSearchParams({
                all: "true",
                type: "pitcher",
                player_type: "pitcher",
                hfSea: `${season}|`,
                hfGT: "R|",
                game_date_gt: `${season}-01-01`,
                game_date_lt: endDate
            });
            params.append("pitchers_lookup[]", String(playerId));
            const request = fetch(`https://baseballsavant.mlb.com/statcast_search/csv?${params}`)
                .then(async (response) => {
                    if (!response.ok) throw new Error(`Baseball Savantを取得できませんでした（${response.status}）`);
                    const lines = (await response.text()).replace(/^\uFEFF/, "")
                        .split(/\r?\n/)
                        .filter(Boolean);
                    if (!lines.length) return [];
                    const headers = parseCsvLine(lines[0]);
                    return lines.slice(1).map((line) => {
                        const values = parseCsvLine(line);
                        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
                    });
                });
            savantCache.set(key, request);
        }
        return savantCache.get(key);
    };

    const aggregatePitcherStatcast = (rows, pitchType, batterSide) => {
        const totals = {
            velocitySum: 0,
            velocityCount: 0,
            swings: 0,
            whiffs: 0,
            chasePitches: 0,
            chases: 0,
            battedBalls: 0,
            hardHits: 0,
            zones: new Map()
        };
        rows.forEach((row) => {
            if (pitchType && row.pitch_type !== pitchType) return;
            if (batterSide && row.stand !== batterSide) return;

            const description = String(row.description ?? "");
            const velocity = Number(row.release_speed);
            if (pitchType && String(row.release_speed ?? "").trim() !== "" && Number.isFinite(velocity)) {
                totals.velocitySum += velocity;
                totals.velocityCount += 1;
            }
            if (SAVANT_PITCH_SWING_DESCRIPTIONS.has(description)) totals.swings += 1;
            if (SAVANT_PITCH_WHIFF_DESCRIPTIONS.has(description)) totals.whiffs += 1;

            const zone = Number(row.zone);
            if (Number.isInteger(zone) && zone >= 11 && zone <= 14) {
                totals.chasePitches += 1;
                if (SAVANT_PITCH_SWING_DESCRIPTIONS.has(description)) totals.chases += 1;
            }

            const launchSpeed = Number(row.launch_speed);
            if (description === "hit_into_play" && String(row.launch_speed ?? "").trim() !== "" && Number.isFinite(launchSpeed)) {
                totals.battedBalls += 1;
                if (launchSpeed >= 95) totals.hardHits += 1;
            }

            const event = String(row.events ?? "");
            if (!SAVANT_AT_BAT_EVENTS.has(event) || !Number.isInteger(zone) || zone === 10 || zone < 1 || zone > 14) return;
            const zoneTotal = totals.zones.get(zone) ?? { atBats: 0, hits: 0 };
            zoneTotal.atBats += 1;
            if (SAVANT_HIT_EVENTS.has(event)) zoneTotal.hits += 1;
            totals.zones.set(zone, zoneTotal);
        });
        const percentage = (part, whole) => whole ? (part * 100) / whole : null;
        return {
            averageVelocity: pitchType && totals.velocityCount
                ? totals.velocitySum / totals.velocityCount
                : null,
            whiffPercent: percentage(totals.whiffs, totals.swings),
            chasePercent: percentage(totals.chases, totals.chasePitches),
            hardHitPercent: percentage(totals.hardHits, totals.battedBalls),
            zones: new Map([...totals.zones.entries()].map(([zone, total]) => [
                zone,
                total.atBats ? total.hits / total.atBats : null
            ]))
        };
    };

    const pitcherPitchTypeLabel = (pitchType, rows = []) => {
        if (SAVANT_PITCH_TYPE_LABELS.has(pitchType)) return SAVANT_PITCH_TYPE_LABELS.get(pitchType);
        return rows.find((row) => row.pitch_type === pitchType)?.pitch_name || pitchType;
    };

    const normalizeKey = (value) => String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();

    const playerName = (person) => {
        const fullName = String(person?.fullName ?? person?.name ?? "-");
        const key = normalizeKey(fullName);
        try {
            if (typeof NHK_PLAYER_NAMES !== "undefined" && NHK_PLAYER_NAMES[key]) {
                return NHK_PLAYER_NAMES[key];
            }
        } catch (_error) {
            // The official name remains available when the optional reading table is unavailable.
        }
        return fullName;
    };

    const teamCode = (team) => String(
        team?.abbreviation ?? team?.teamCode ?? team?.fileCode ??
        window.MLB_SCOREBOOK_TEAM_CODES_BY_ID?.[Number(team?.id)] ?? team?.name ?? "-"
    ).toUpperCase();

    const teamJapaneseName = (team) => {
        const idName = window.MLB_SCOREBOOK_TEAM_NAMES_BY_ID?.[Number(team?.id)];
        if (idName) return idName;
        const candidates = [team?.name, team?.teamName, team?.clubName];
        for (const candidate of candidates) {
            const converted = window.MLB_SCOREBOOK_NHK_TEAM_NAMES?.[normalizeKey(candidate)];
            if (converted) return converted;
        }
        return candidates.find(Boolean) ?? teamCode(team);
    };

    const teamJapaneseShortName = (team) => ({
        108: "エンゼルス", 109: "ダイヤモンドバックス", 110: "オリオールズ",
        111: "レッドソックス", 112: "カブス", 113: "レッズ", 114: "ガーディアンズ",
        115: "ロッキーズ", 116: "タイガース", 117: "アストロズ", 118: "ロイヤルズ",
        119: "ドジャース", 120: "ナショナルズ", 121: "メッツ", 133: "アスレチックス",
        134: "パイレーツ", 135: "パドレス", 136: "マリナーズ", 137: "ジャイアンツ",
        138: "カーディナルス", 139: "レイズ", 140: "レンジャーズ", 141: "ブルージェイズ",
        142: "ツインズ", 143: "フィリーズ", 144: "ブレーブス", 145: "ホワイトソックス",
        146: "マーリンズ", 147: "ヤンキース", 158: "ブルワーズ"
    })[Number(team?.id)] ?? teamJapaneseName(team);

    const TEAM_CARD_COLORS = {
        108: "#ba0021", 109: "#a71930", 110: "#df4601", 111: "#bd3039",
        112: "#0e3386", 113: "#c6011f", 114: "#00385d", 115: "#33006f",
        116: "#0c2340", 117: "#002d62", 118: "#004687", 119: "#005a9c",
        120: "#ab0003", 121: "#002d72", 133: "#003831", 134: "#fdb827",
        135: "#2f241d", 136: "#005c5c", 137: "#fd5a1e", 138: "#c41e3a",
        139: "#092c5c", 140: "#003278", 141: "#134a8e", 142: "#002b5c",
        143: "#e81828", 144: "#ce1141", 145: "#27251f", 146: "#00a3e0",
        147: "#0c2340", 158: "#12284b"
    };
    const MLB_TEAM_IDS = new Set(Object.keys(TEAM_CARD_COLORS).map(Number));

    const TEAM_SOCIAL_ACCOUNTS = {
        108: ["angels", "angels"], 109: ["dbacks", "dbacks"],
        110: ["orioles", "orioles"], 111: ["redsox", "redsox"],
        112: ["cubs", "cubs"], 113: ["reds", "reds"],
        114: ["cleguardians", "CLEGuardians"], 115: ["rockies", "rockies"],
        116: ["tigers", "tigers"], 117: ["astros", "astrosbaseball"],
        118: ["royals", "kcroyals"], 119: ["dodgers", "dodgers"],
        120: ["nationals", "nationals"], 121: ["mets", "mets"],
        133: ["athletics", "athletics"], 134: ["Pirates", "pittsburghpirates"],
        135: ["padres", "padres"], 136: ["mariners", "mariners"],
        137: ["sfgiants", "SFGiants"], 138: ["cardinals", "cardinals"],
        139: ["raysbaseball", "raysbaseball"], 140: ["rangers", "rangers"],
        141: ["bluejays", "bluejays"], 142: ["twins", "twins"],
        143: ["phillies", "phillies"], 144: ["braves", "braves"],
        145: ["whitesox", "whitesox"], 146: ["marlins", "marlins"],
        147: ["yankees", "yankees"], 158: ["brewers", "brewers"]
    };

    const MLB_TEAM_LEAGUE_BY_ID = new Map([
        [108, "AL"], [110, "AL"], [111, "AL"], [114, "AL"], [116, "AL"],
        [117, "AL"], [118, "AL"], [133, "AL"], [136, "AL"], [139, "AL"],
        [140, "AL"], [141, "AL"], [142, "AL"], [145, "AL"], [147, "AL"],
        [109, "NL"], [112, "NL"], [113, "NL"], [115, "NL"], [119, "NL"],
        [120, "NL"], [121, "NL"], [134, "NL"], [135, "NL"], [137, "NL"],
        [138, "NL"], [143, "NL"], [144, "NL"], [146, "NL"], [158, "NL"]
    ]);

    const teamLeagueCode = (team) => {
        const leagueId = Number(team?.league?.id);
        if (leagueId === 103) return "AL";
        if (leagueId === 104) return "NL";
        return MLB_TEAM_LEAGUE_BY_ID.get(Number(team?.id)) ?? "";
    };

    const gameLeagueCategory = (game) => {
        const awayLeague = teamLeagueCode(game?.teams?.away?.team);
        const homeLeague = teamLeagueCode(game?.teams?.home?.team);
        if (awayLeague && awayLeague === homeLeague) return awayLeague;
        if (awayLeague && homeLeague) return "INTERLEAGUE";
        return "";
    };

    const postseasonLeagueCode = (game) => {
        const category = gameLeagueCategory(game);
        if (["AL", "NL"].includes(category)) return category;
        const description = String(game?.seriesDescription ?? "").toLowerCase();
        if (/american league|\bal\b/.test(description)) return "AL";
        if (/national league|\bnl\b/.test(description)) return "NL";
        return "";
    };

    const gameScheduleCategory = (game) => {
        const gameType = String(game?.gameType ?? "").toUpperCase();
        const league = postseasonLeagueCode(game);
        if (gameType === "F") {
            return league ? `${league}ワイルドカードシリーズ` : "ワイルドカードシリーズ";
        }
        if (gameType === "D") {
            return league ? `${league}ディビジョンシリーズ` : "ディビジョンシリーズ";
        }
        if (gameType === "L") {
            return league ? `${league}リーグ優勝決定戦` : "リーグ優勝決定戦";
        }
        if (gameType === "W") return "ワールドシリーズ";
        if (["P", "C"].includes(gameType)) return "ポストシーズン";
        return gameLeagueCategory(game);
    };

    const GAME_CATEGORY_ORDER = Object.freeze([
        "AL", "NL", "INTERLEAGUE",
        "ALワイルドカードシリーズ", "NLワイルドカードシリーズ", "ワイルドカードシリーズ",
        "ALディビジョンシリーズ", "NLディビジョンシリーズ", "ディビジョンシリーズ",
        "ALリーグ優勝決定戦", "NLリーグ優勝決定戦", "リーグ優勝決定戦",
        "ワールドシリーズ", "ポストシーズン"
    ]);

    const setGameCardTeamColors = (card, awayTeam, homeTeam) => {
        card.style.setProperty(
            "--pregame-away-color",
            TEAM_CARD_COLORS[Number(awayTeam?.id)] ?? "#66727a"
        );
        card.style.setProperty(
            "--pregame-home-color",
            TEAM_CARD_COLORS[Number(homeTeam?.id)] ?? "#879198"
        );
    };

    const formatDate = (date) => {
        const [year, month, day] = String(date ?? "").slice(0, 10).split("-");
        return year && month && day ? `${year}/${Number(month)}/${Number(day)}` : String(date ?? "-");
    };

    const parseMlbDate = (date) => {
        const normalized = String(date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
        const value = new Date(`${normalized}T00:00:00Z`);
        return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === normalized
            ? value
            : null;
    };

    const previousDate = (date) => {
        const value = parseMlbDate(date);
        if (!value) return "";
        value.setUTCDate(value.getUTCDate() - 1);
        return value.toISOString().slice(0, 10);
    };

    const shiftDate = (date, days) => {
        const value = parseMlbDate(date);
        if (!value) return "";
        value.setUTCDate(value.getUTCDate() + days);
        return value.toISOString().slice(0, 10);
    };

    const currentEasternDate = (now = new Date()) => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(now);
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    };

    const currentMlbDate = () => currentEasternDate();

    const getStatus = (game) => String(
        game?.status?.detailedState ?? game?.status?.abstractGameState ?? "Scheduled"
    );

    const statusLabel = (game) => {
        const status = getStatus(game).toLowerCase();
        if (/final|completed/.test(status)) return "終了";
        if (/live|progress/.test(status)) return "試合中";
        if (/delay/.test(status)) return "中断";
        if (/postpon/.test(status)) return "延期";
        if (/cancel/.test(status)) return "中止";
        if (/warmup|pre-game/.test(status)) return "試合前";
        if (/scheduled|preview/.test(status)) return "開始前";
        return "予定";
    };

    const japanesePlayerGameStatusLabel = (game) => {
        const label = statusLabel(game);
        if (label === "終了") return "試合終了";
        if (["開始前", "予定"].includes(label)) return "試合前";
        return label;
    };

    const statusReasonLabel = (reason) => {
        const value = String(reason ?? "").trim();
        const normalized = value.toLowerCase();
        if (!value) return "";
        if (/rain/.test(normalized)) return "雨天";
        if (/inclement weather|weather/.test(normalized)) return "悪天候";
        if (/wet grounds|ground conditions|unplayable field/.test(normalized)) {
            return "グラウンドコンディション不良";
        }
        if (/air quality/.test(normalized)) return "大気状態不良";
        if (/power/.test(normalized)) return "停電";
        return "";
    };

    const explicitRescheduleDate = (game) => {
        const candidates = [
            game?.rescheduleDate,
            game?.resumeDate,
            game?.rescheduledGameDate,
            game?.status?.rescheduleDate,
            game?.status?.resumeDate
        ];
        const value = candidates.find((candidate) => /^\d{4}-\d{2}-\d{2}/.test(String(candidate ?? "")));
        if (!value) return "";
        const [, month, day] = String(value).slice(0, 10).split("-");
        return month && day ? `${Number(month)}月${Number(day)}日` : "";
    };

    const gameCardStatusLabel = (game) => {
        const detailed = String(game?.status?.detailedState ?? "");
        const abstract = String(game?.status?.abstractGameState ?? "");
        const coded = String(game?.status?.codedGameState ?? "");
        const reason = String(game?.status?.reason ?? game?.reason ?? "");
        const combined = `${detailed} ${abstract} ${reason}`.toLowerCase();
        const translatedReason = statusReasonLabel(reason || detailed);
        const rescheduleDate = explicitRescheduleDate(game);

        if (/postpon|resched/.test(combined)) {
            const prefix = translatedReason === "雨天"
                ? "雨天順延"
                : translatedReason
                    ? `${translatedReason}による順延`
                    : "順延";
            return rescheduleDate ? `${prefix}（${rescheduleDate}）` : prefix;
        }
        if (/cancel/.test(combined) || coded === "C") {
            return translatedReason ? `${translatedReason}による中止` : "中止";
        }
        if (/suspend|delay|paused/.test(combined)) {
            if (translatedReason === "雨天") return "雨天中断";
            if (translatedReason) return `${translatedReason}による中断`;
            return "一時中断";
        }
        if (/final|completed|game over/.test(combined) || coded === "F") return "終了";
        if (/warmup|pre-game|scheduled|preview/.test(combined) || ["P", "S"].includes(coded)) {
            return "試合前";
        }
        if (/live|in progress|manager challenge|review/.test(combined)) {
            const inning = Number(game?.linescore?.currentInning);
            if (!inning) {
                const scheduledStart = Date.parse(String(game?.gameDate ?? ""));
                return Number.isFinite(scheduledStart) && scheduledStart > Date.now()
                    ? "試合前"
                    : "試合中";
            }
            const inningState = String(game?.linescore?.inningState ?? "").toLowerCase();
            const half = game?.linescore?.isTopInning || /^top/.test(inningState)
                ? "表"
                : game?.linescore?.isBottomInning || /^bottom/.test(inningState)
                    ? "裏"
                    : "";
            return `${inning}回${half}`;
        }
        return "状態確認中";
    };

    const positionLabel = (position) => ({
        P: "投手", C: "捕手", "1B": "一塁手", "2B": "二塁手", "3B": "三塁手",
        SS: "遊撃手", LF: "左翼手", CF: "中堅手", RF: "右翼手", DH: "指名打者",
        PH: "代打", PR: "代走", TWP: "二刀流"
    })[String(position ?? "").toUpperCase()] ?? String(position ?? "-");

    const venueLabel = (venue) => {
        const name = String(venue?.name ?? "");
        const key = normalizeKey(name);
        return window.MLB_SCOREBOOK_JAPANESE_VENUE_NAMES?.[key] ?? name;
    };

    const isFinal = (game) => /final|completed/i.test(getStatus(game));
    const isLive = (game) => /live|progress|delay/i.test(getStatus(game));

    const getSchedule = async (date) => {
        const params = new URLSearchParams({
            sportId: "1",
            date,
            hydrate: "team,probablePitcher,linescore"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/schedule?${params}`,
            `pregame:schedule:${date}`
        );
        const games = (payload?.dates ?? []).flatMap((entry) => entry?.games ?? []);
        games.forEach((game) => gameIndex.set(Number(game.gamePk), game));
        return games;
    };

    const calculateCurrentSeriesStanding = (scheduleGames, gamePk, teamId, opponentId) => {
        const games = scheduleGames
            .filter((entry) => [
                Number(entry?.teams?.away?.team?.id),
                Number(entry?.teams?.home?.team?.id)
            ].includes(Number(teamId)))
            .sort((a, b) => {
                const dateOrder = String(a?.gameDate ?? a?.officialDate ?? "")
                    .localeCompare(String(b?.gameDate ?? b?.officialDate ?? ""));
                return dateOrder || Number(a?.gamePk) - Number(b?.gamePk);
            });
        const targetIndex = games.findIndex((entry) => Number(entry?.gamePk) === Number(gamePk));
        if (targetIndex < 0) return null;
        const target = games[targetIndex];
        const totalGames = Number(target?.gamesInSeries);
        const targetNumber = Number(target?.seriesGameNumber);
        if (!Number.isInteger(totalGames) || totalGames < 2 ||
            !Number.isInteger(targetNumber) || targetNumber < 1 || targetNumber > totalGames) return null;
        const hasSameTeams = (entry) => {
            const ids = [Number(entry?.teams?.away?.team?.id), Number(entry?.teams?.home?.team?.id)];
            return ids.includes(Number(teamId)) && ids.includes(Number(opponentId));
        };
        let start = targetIndex;
        let end = targetIndex;
        while (start > 0 && hasSameTeams(games[start - 1])) start -= 1;
        while (end + 1 < games.length && hasSameTeams(games[end + 1])) end += 1;
        const seriesGames = games.slice(start, end + 1);
        const seriesNumbers = new Set(seriesGames.map((entry) => Number(entry?.seriesGameNumber)));
        if (seriesGames.length !== totalGames || seriesNumbers.size !== totalGames ||
            [...seriesNumbers].some((number) => number < 1 || number > totalGames)) return null;

        const wins = new Map([[Number(teamId), 0], [Number(opponentId), 0]]);
        seriesGames.forEach((entry) => {
            // Keep the matchup header at the instant immediately before the selected game.
            // The selected game's result must not appear when this page is opened afterward.
            if (Number(entry?.seriesGameNumber) >= targetNumber || !isFinal(entry)) return;
            const away = entry?.teams?.away ?? {};
            const home = entry?.teams?.home ?? {};
            const awayScore = Number(away?.score);
            const homeScore = Number(home?.score);
            const winnerId = away?.isWinner === true || (Number.isFinite(awayScore) && awayScore > homeScore)
                ? Number(away?.team?.id)
                : home?.isWinner === true || (Number.isFinite(homeScore) && homeScore > awayScore)
                    ? Number(home?.team?.id)
                    : 0;
            if (wins.has(winnerId)) wins.set(winnerId, wins.get(winnerId) + 1);
        });
        return { totalGames, wins };
    };

    const getSeriesSchedule = async (date, teamId = "") => {
        const params = new URLSearchParams({
            sportId: "1",
            startDate: shiftDate(date, -10),
            endDate: shiftDate(date, 10),
            gameType: "R",
            hydrate: "team,linescore"
        });
        if (teamId) params.set("teamId", String(teamId));
        const payload = await fetchJson(
            `${API_ROOT}/v1/schedule?${params}`,
            `pregame:series-schedule:${teamId || "all"}:${date}`
        ).catch(() => null);
        return (payload?.dates ?? []).flatMap((entry) => entry?.games ?? []);
    };

    const getCurrentSeriesStanding = async (gamePk, teamId, opponentId, date) => {
        const games = await getSeriesSchedule(date, teamId);
        return calculateCurrentSeriesStanding(games, gamePk, teamId, opponentId);
    };

    const getSeasonJapanesePlayers = async (season) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/sports/1/players?season=${season}&hydrate=currentTeam`,
            `pregame:japanese:${season}`
        );
        return (payload?.people ?? []).filter((person) =>
            globalThis.MLBJapanesePlayers?.isJapanesePlayer(person) ??
            String(person?.birthCountry ?? person?.country ?? "").toLowerCase() === "japan"
        );
    };

    const getJapanesePlayerTransactions = async (people, season, date) => {
        const playerIds = people.map((person) => Number(person?.id)).filter(Boolean);
        if (!playerIds.length) return [];
        const params = new URLSearchParams({
            playerId: playerIds.join(","),
            startDate: `${season}-01-01`,
            endDate: date
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/transactions?${params}`,
            `pregame:japanese-transactions:${season}:${date}:${playerIds.join("-")}`
        ).catch(() => null);
        return payload?.transactions ?? [];
    };

    const getMinorTeamDetails = async (transactions) => {
        const teamIds = [...new Set(transactions
            .filter((transaction) => ["OPT", "ASG"].includes(String(transaction?.typeCode ?? "").toUpperCase()))
            .map((transaction) => Number(transaction?.toTeam?.id))
            .filter((teamId) => teamId && !MLB_TEAM_IDS.has(teamId)))];
        const entries = await Promise.all(teamIds.map(async (teamId) => {
            const payload = await fetchJson(
                `${API_ROOT}/v1/teams/${teamId}`,
                `pregame:team-details:${teamId}`
            ).catch(() => null);
            return [teamId, payload?.teams?.[0] ?? null];
        }));
        return new Map(entries);
    };

    const minorTeamStatus = (transaction, minorTeams) => {
        const teamId = Number(transaction?.toTeam?.id);
        const team = minorTeams.get(teamId) ?? transaction?.toTeam ?? {};
        const abbreviation = String(team?.sport?.abbreviation ?? "").toUpperCase();
        const sportName = String(team?.sport?.name ?? "");
        const level = ({ AAA: "3A", AA: "2A", "A+": "High-A", A: "1A", ROK: "ルーキー" })[abbreviation]
            ?? ({ "TRIPLE-A": "3A", "DOUBLE-A": "2A" })[sportName.toUpperCase()]
            ?? sportName
            ?? "マイナー";
        return `${level} ${team?.name ?? transaction?.toTeam?.name ?? "所属"}`;
    };

    const injuredListStatus = (description) => {
        const text = String(description ?? "");
        const days = text.match(/(\d+)-day injured list/i)?.[1];
        return days ? `${days}日間IL` : "IL";
    };

    const japanesePlayerLogGroups = (person) => {
        const position = String(person?.primaryPosition?.abbreviation ?? "").toUpperCase();
        if (position === "TWP") return ["hitting", "pitching"];
        return [position === "P" ? "pitching" : "hitting"];
    };

    const getJapanesePlayerGameHistory = async (person, season, date) => {
        const logs = await Promise.all(
            japanesePlayerLogGroups(person).map((group) =>
                getPlayerGameLog(person.id, season, group).catch(() => [])
            )
        );
        return logs.flat().filter((split) => String(split?.date ?? "") < date);
    };

    const transactionDate = (transaction) => String(
        transaction?.date ?? transaction?.effectiveDate ?? ""
    ).slice(0, 10);

    const isMlbRosterTransaction = (transaction, mlbTeamIds) => {
        const code = String(transaction?.typeCode ?? "").toUpperCase();
        const toTeamId = Number(transaction?.toTeam?.id);
        if (!mlbTeamIds.has(toTeamId)) return false;
        if (["CU", "SE", "CP", "R5"].includes(code)) return true;
        return code === "SC" && /injured list|activated/i.test(String(transaction?.description ?? ""));
    };

    const japanesePlayerTeamAtDate = ({
        person,
        date,
        gameHistory,
        transactions,
        activeTeamId,
        minorTeams
    }) => {
        const events = gameHistory.map((split) => ({
            date: String(split?.date ?? ""),
            order: 1,
            teamId: Number(split?.team?.id) || null,
            team: split?.team ?? null,
            qualifies: true,
            rosterStatus: ""
        }));
        transactions
            .filter((transaction) => Number(transaction?.person?.id) === Number(person?.id))
            .filter((transaction) => transactionDate(transaction) <= date)
            .forEach((transaction) => {
                const code = String(transaction?.typeCode ?? "").toUpperCase();
                const toTeamId = Number(transaction?.toTeam?.id);
                const fromTeamId = Number(transaction?.fromTeam?.id);
                let teamId;
                let team;
                let rosterStatus;
                const description = String(transaction?.description ?? "");
                if (["DFA", "REL", "URL", "NTC"].includes(code) && MLB_TEAM_IDS.has(fromTeamId)) {
                    teamId = null;
                    team = null;
                    rosterStatus = code === "DFA" ? "FA" : "自由契約";
                } else if (MLB_TEAM_IDS.has(toTeamId)) {
                    teamId = toTeamId;
                    team = transaction?.toTeam ?? { id: toTeamId };
                    if (code === "SC" && /placed|transferred/i.test(description) && /injured list/i.test(description)) {
                        rosterStatus = injuredListStatus(description);
                    } else if (code === "SC" && /activated/i.test(description)) {
                        rosterStatus = "";
                    } else if (["CU", "SE", "CP", "R5", "TR"].includes(code)) {
                        rosterStatus = "";
                    }
                } else if (MLB_TEAM_IDS.has(fromTeamId) && ["OPT", "DES", "ASG"].includes(code)) {
                    teamId = fromTeamId;
                    team = transaction?.fromTeam ?? { id: fromTeamId };
                    if (code === "OPT") rosterStatus = minorTeamStatus(transaction, minorTeams);
                    if (code === "DES") rosterStatus = "DFA";
                } else {
                    return;
                }
                events.push({
                    date: transactionDate(transaction),
                    order: 2,
                    teamId,
                    team,
                    qualifies: isMlbRosterTransaction(transaction, MLB_TEAM_IDS),
                    rosterStatus
                });
            });
        if (activeTeamId) {
            events.push({
                date,
                order: 3,
                teamId: activeTeamId,
                team: Number(person?.currentTeam?.id) === Number(activeTeamId)
                    ? person.currentTeam
                    : { id: activeTeamId },
                qualifies: true,
                rosterStatus: ""
            });
        }
        events.sort((left, right) =>
            left.date.localeCompare(right.date) || left.order - right.order
        );
        if (!events.some((event) => event.qualifies)) return null;
        let teamId = null;
        let team = null;
        let rosterStatus = "";
        events.forEach((event) => {
            teamId = event.teamId;
            if (event.team !== undefined) team = event.team;
            if (event.rosterStatus !== undefined) rosterStatus = event.rosterStatus;
        });
        return {
            teamId: teamId || null,
            team,
            rosterStatus,
            active: Boolean(teamId) && Number(activeTeamId) === Number(teamId)
        };
    };

    const getActiveRosterIds = async (teamId, date) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/teams/${teamId}/roster?rosterType=active&date=${date}`,
            `pregame:active-roster:${teamId}:${date}`
        ).catch(() => null);
        return new Set((payload?.roster ?? []).map((entry) => Number(entry?.person?.id)));
    };

    const getActiveRosterPlayers = async (teamId, date) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/teams/${teamId}/roster?rosterType=active&date=${date}&hydrate=person`,
            `pregame:active-roster-players:${teamId}:${date}`
        ).catch(() => null);
        return payload?.roster ?? [];
    };

    const getFeed = (gamePk) => fetchJson(
        `${API_ROOT}/v1.1/game/${gamePk}/feed/live`,
        `pregame:feed:${gamePk}`
    );

    const isDailyJapaneseGameLive = (game) => /live|progress|delay|review|challenge/i.test(
        `${game?.status?.detailedState ?? ""} ${game?.status?.abstractGameState ?? ""}`
    );

    const getDailyJapaneseFeed = async (game) => {
        if (!isDailyJapaneseGameLive(game)) return getFeed(game.gamePk);
        const response = await fetch(`${API_ROOT}/v1.1/game/${game.gamePk}/feed/live`);
        if (!response.ok) throw new Error(`MLB公式データを取得できませんでした（${response.status}）`);
        return response.json();
    };

    const getJapaneseDailyPitcherRoles = async (teamId, date) => {
        const depthChart = await fetchJson(
            `${API_ROOT}/v1/teams/${teamId}/roster/depthChart?date=${date}`,
            `pregame:depth-chart:${teamId}:${date}`
        ).catch(() => null);
        const relieverIds = new Set((depthChart?.roster ?? [])
            .filter((entry) => String(entry?.position?.abbreviation ?? "").toUpperCase() === "P")
            .map((entry) => Number(entry?.person?.id)));
        return { relieverIds };
    };

    const japanesePlayerDailyRoles = (person, officialRoles = null) => {
        const position = String(person?.primaryPosition?.abbreviation ?? "").toUpperCase();
        const twoWay = position === "TWP";
        const pitcher = position === "P" || twoWay;
        return {
            hitter: !pitcher || twoWay,
            pitcher,
            twoWay,
            pitcherRole: pitcher
                ? (officialRoles?.relieverIds?.has(Number(person?.id)) ? "reliever" : "starter")
                : ""
        };
    };

    const isJapaneseDailyStatsVisible = (person) => !(
        /(?:^|\s)(?:\d+日間)?IL(?:\s|$)|3A|2A|High-A|1A|ルーキー|マイナー|リハビリ/i
            .test(String(person?.pregameRosterState?.rosterStatus ?? ""))
    );

    const teamSideInGame = (game, teamId) =>
        Number(game?.teams?.away?.team?.id) === Number(teamId) ? "away" :
            Number(game?.teams?.home?.team?.id) === Number(teamId) ? "home" : "";

    const dailyOpponent = (game, side) =>
        game?.teams?.[side === "away" ? "home" : "away"]?.team ?? {};

    const mlbGamedayUrl = (game) => {
        const gamePk = Number(game?.gamePk);
        if (!gamePk) return "";
        const teamSlug = (team) => String(
            team?.clubName ?? team?.teamName ?? team?.name ?? "team"
        ).toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "team";
        const away = teamSlug(game?.teams?.away?.team);
        const home = teamSlug(game?.teams?.home?.team);
        const date = String(game?.officialDate ?? currentDate ?? "");
        const datePath = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replaceAll("-", "/") : "";
        const state = isFinal(game) ? "final" : isDailyJapaneseGameLive(game) ? "live" : "preview";
        return datePath
            ? `https://www.mlb.com/gameday/${away}-vs-${home}/${datePath}/${gamePk}/${state}`
            : `https://www.mlb.com/gameday/${gamePk}/${state}`;
    };

    const dailyGamedayUrl = (appearances) => {
        const selected = appearances.find(({ game }) => isDailyJapaneseGameLive(game)) ??
            appearances.find(({ game }) => !isFinal(game)) ??
            appearances.at(-1);
        return mlbGamedayUrl(selected?.game);
    };

    const hasDailyBattingAppearance = (entry) =>
        statNumber(entry?.stats?.batting?.gamesPlayed) > 0 ||
        Boolean(String(entry?.battingOrder ?? "").trim());

    const hasDailyPitchingAppearance = (entry) => {
        const pitching = entry?.stats?.pitching ?? {};
        return statNumber(pitching.gamesPlayed) > 0 ||
            statNumber(pitching.numberOfPitches ?? pitching.pitchesThrown) > 0 ||
            inningsToOuts(pitching.inningsPitched) > 0;
    };

    const dailyAppearanceStatus = (appearances) => {
        const live = appearances.find(({ game }) => isDailyJapaneseGameLive(game));
        if (live) return { label: gameCardStatusLabel(live.game), live: true };
        return { label: "試合終了", live: false };
    };

    const dailyOpponentLabel = (appearances) => {
        const codes = [...new Set(appearances.map(({ game, side }) =>
            teamCode(dailyOpponent(game, side))
        ).filter(Boolean))];
        return codes.length ? `vs.${codes.join("/")}` : "vs.-";
    };

    const buildJapaneseDailyStats = async (people, gamesByTeam) => {
        const visiblePeople = people.filter(isJapaneseDailyStatsVisible);
        const date = String(currentDate ?? "");
        const teamIds = [...new Set(visiblePeople
            .filter((person) => {
                const position = String(person?.primaryPosition?.abbreviation ?? "").toUpperCase();
                const games = gamesByTeam.get(Number(person.pregameTeamId)) ?? [];
                const isProbable = games.some((game) => {
                    const side = teamSideInGame(game, person.pregameTeamId);
                    return Number(game?.teams?.[side]?.probablePitcher?.id) === Number(person.id);
                });
                return position === "P" && games.some((game) => !isFinal(game)) && !isProbable;
            })
            .map((person) => Number(person.pregameTeamId))
            .filter(Boolean))];
        const officialRoleEntries = await Promise.all(teamIds.map(async (teamId) => [
            teamId,
            await getJapaneseDailyPitcherRoles(teamId, date).catch(() => null)
        ]));
        const officialRolesByTeam = new Map(officialRoleEntries);
        const relevantGames = [...new Map(visiblePeople.flatMap((person) =>
            (gamesByTeam.get(Number(person.pregameTeamId)) ?? [])
                .filter((game) => isDailyJapaneseGameLive(game) || isFinal(game))
                .map((game) => [Number(game.gamePk), game])
        )).values()];
        const feedEntries = await Promise.all(relevantGames.map(async (game) => [
            Number(game.gamePk),
            await getDailyJapaneseFeed(game).catch(() => null)
        ]));
        const feeds = new Map(feedEntries);
        const hitters = [];
        const pitchers = [];
        const absent = [];
        const bullpenWaiting = [];
        const noPitching = [];
        const noGame = [];

        visiblePeople.forEach((person) => {
            const teamId = Number(person.pregameTeamId);
            const games = gamesByTeam.get(teamId) ?? [];
            const officialRoles = officialRolesByTeam.get(teamId);
            let roles = japanesePlayerDailyRoles(person, officialRoles);
            if (!games.length) {
                noGame.push({ name: playerName(person), gameUrl: "" });
                return;
            }
            const appearances = games.map((game) => {
                const side = teamSideInGame(game, teamId);
                const feed = feeds.get(Number(game.gamePk));
                const entry = side
                    ? feed?.liveData?.boxscore?.teams?.[side]?.players?.[`ID${person.id}`]
                    : null;
                const decisions = feed?.liveData?.decisions ?? {};
                return {
                    game,
                    side,
                    entry,
                    decision: {
                        wins: Number(decisions?.winner?.id) === Number(person.id) ? 1 : 0,
                        losses: Number(decisions?.loser?.id) === Number(person.id) ? 1 : 0,
                        saves: Number(decisions?.save?.id) === Number(person.id) ? 1 : 0
                    }
                };
            });
            const battingAppearances = appearances.filter(({ entry }) =>
                hasDailyBattingAppearance(entry)
            );
            const pitchingAppearances = appearances.filter(({ entry }) =>
                hasDailyPitchingAppearance(entry)
            );
            const probableAppearances = appearances.filter(({ game, side }) =>
                !isFinal(game) &&
                Number(game?.teams?.[side]?.probablePitcher?.id) === Number(person.id)
            );
            if (battingAppearances.length) {
                roles = {
                    ...roles,
                    hitter: true,
                    twoWay: roles.twoWay || roles.pitcher
                };
            }
            if (pitchingAppearances.length || probableAppearances.length) {
                roles = { ...roles, pitcher: true };
            }

            if (battingAppearances.length && roles.hitter) {
                const stats = battingAppearances.reduce((total, { entry }) => {
                    const batting = entry?.stats?.batting ?? {};
                    ["atBats", "hits", "homeRuns", "rbi", "stolenBases", "strikeOuts", "baseOnBalls"]
                        .forEach((field) => { total[field] += statNumber(batting[field]); });
                    return total;
                }, { atBats: 0, hits: 0, homeRuns: 0, rbi: 0, stolenBases: 0, strikeOuts: 0, baseOnBalls: 0 });
                hitters.push({
                    person,
                    ...dailyAppearanceStatus(battingAppearances),
                    opponent: dailyOpponentLabel(battingAppearances),
                    gameUrl: dailyGamedayUrl(battingAppearances),
                    stats
                });
            } else if (roles.hitter && !probableAppearances.length) {
                absent.push({
                    name: playerName(person),
                    gameUrl: dailyGamedayUrl(appearances)
                });
            }

            if (pitchingAppearances.length) {
                const stats = pitchingAppearances.reduce((total, { entry, decision }) => {
                    const pitching = entry?.stats?.pitching ?? {};
                    total.outs += inningsToOuts(pitching.inningsPitched);
                    total.pitches += statNumber(pitching.numberOfPitches ?? pitching.pitchesThrown);
                    ["hits", "runs", "earnedRuns", "strikeOuts", "baseOnBalls"]
                        .forEach((field) => { total[field] += statNumber(pitching[field]); });
                    ["wins", "losses", "saves"]
                        .forEach((field) => { total[field] += statNumber(decision?.[field]); });
                    return total;
                }, { outs: 0, pitches: 0, hits: 0, runs: 0, earnedRuns: 0, strikeOuts: 0, baseOnBalls: 0, wins: 0, losses: 0, saves: 0 });
                pitchers.push({
                    person,
                    ...dailyAppearanceStatus(pitchingAppearances),
                    opponent: dailyOpponentLabel(pitchingAppearances),
                    gameUrl: dailyGamedayUrl(pitchingAppearances),
                    stats: { ...stats, inningsPitched: formatInnings(stats.outs) }
                });
            } else if (probableAppearances.length) {
                const statusGame = probableAppearances.find(({ game }) =>
                    isDailyJapaneseGameLive(game)
                ) ?? probableAppearances[0];
                pitchers.push({
                    person,
                    label: gameCardStatusLabel(statusGame.game),
                    live: isDailyJapaneseGameLive(statusGame.game),
                    opponent: dailyOpponentLabel(probableAppearances),
                    gameUrl: mlbGamedayUrl(statusGame.game),
                    stats: {
                        inningsPitched: "0.0", pitches: 0, hits: 0, runs: 0,
                        earnedRuns: 0, strikeOuts: 0, baseOnBalls: 0,
                        wins: 0, losses: 0, saves: 0
                    }
                });
            } else if (roles.pitcher && !roles.twoWay) {
                const allGamesFinal = games.every((game) => isFinal(game));
                if (roles.pitcherRole === "reliever" && !allGamesFinal) {
                    bullpenWaiting.push({
                        name: playerName(person),
                        gameUrl: dailyGamedayUrl(appearances)
                    });
                } else {
                    noPitching.push({
                        name: playerName(person),
                        gameUrl: dailyGamedayUrl(appearances)
                    });
                }
            }
        });

        return { hitters, pitchers, absent, bullpenWaiting, noPitching, noGame };
    };

    const renderJapaneseDailyTable = (title, columns, rows) => {
        const block = el("section", "pregame-japanese-daily-group");
        block.append(el("h4", "pregame-japanese-daily-heading", title));
        if (!rows.length) {
            block.append(empty(`${title}の出場選手はいません。`));
            return block;
        }
        const scroller = el("div", "pregame-japanese-daily-scroll");
        const table = el("table", "pregame-japanese-daily-table");
        const head = el("thead");
        const headRow = el("tr");
        columns.forEach(({ label }) => headRow.append(el("th", "", label)));
        head.append(headRow);
        const body = el("tbody");
        rows.forEach((row) => {
            const tableRow = el("tr");
            tableRow.dataset.pregamePlayer = String(row.person.id);
            columns.forEach(({ field, value }) => {
                const cell = el("td", field === "status" && row.live ? "pregame-japanese-daily-live" : "");
                const text = String(value ? value(row) : row.stats[field] ?? "-");
                if (field === "player" && row.gameUrl) {
                    const link = el("a", "pregame-player-link", text);
                    link.href = row.gameUrl;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    cell.append(link);
                } else {
                    cell.textContent = text;
                }
                tableRow.append(cell);
            });
            body.append(tableRow);
        });
        table.append(head, body);
        scroller.append(table);
        block.append(scroller);
        return block;
    };

    const renderJapaneseDailyStats = (daily) => {
        const wrapper = section("日本人選手 当日成績一覧");
        wrapper.classList.add("pregame-japanese-daily-section");
        const layout = el("div", "pregame-japanese-daily-layout");
        const tables = el("div", "pregame-japanese-daily-tables");
        const commonColumns = [
            { label: "試合状況", field: "status", value: (row) => row.label },
            { label: "選手名", field: "player", value: (row) => playerName(row.person) },
            { label: "対戦相手", field: "opponent", value: (row) => row.opponent }
        ];
        const pitcherColumns = commonColumns.map((column) => column.field !== "player"
            ? column
            : {
                ...column,
                value: (row) => {
                    const decisions = [
                        ["wins", "W"],
                        ["losses", "L"],
                        ["saves", "S"]
                    ].filter(([field]) => statNumber(row.stats[field]) > 0)
                        .map(([, label]) => `（${label}）`)
                        .join("");
                    return `${playerName(row.person)}${decisions}`;
                }
            });
        tables.append(
            renderJapaneseDailyTable("野手", [
                ...commonColumns,
                { label: "打数", field: "atBats" },
                { label: "安打", field: "hits" },
                { label: "本塁打", field: "homeRuns" },
                { label: "打点", field: "rbi" },
                { label: "盗塁", field: "stolenBases" },
                { label: "三振", field: "strikeOuts" },
                { label: "四球", field: "baseOnBalls" }
            ], daily.hitters),
            renderJapaneseDailyTable("投手", [
                ...pitcherColumns,
                { label: "投球回", field: "inningsPitched" },
                { label: "球数", field: "pitches" },
                { label: "被安打", field: "hits" },
                { label: "失点", field: "runs" },
                { label: "自責点", field: "earnedRuns" },
                { label: "奪三振", field: "strikeOuts" },
                { label: "四球", field: "baseOnBalls" }
            ], daily.pitchers)
        );
        const inactive = el("div", "pregame-japanese-daily-inactive");
        [
            ["欠場", daily.absent],
            ["ブルペン待機", daily.bullpenWaiting],
            ["登板なし", daily.noPitching],
            ["試合なし", daily.noGame]
        ].forEach(([label, names]) => {
            if (!names.length) return;
            const row = el("div", "pregame-japanese-daily-inactive-row");
            row.append(el("strong", "", label));
            names.forEach((entry) => {
                const item = typeof entry === "string" ? { name: entry, gameUrl: "" } : entry;
                const name = el("span");
                if (item.gameUrl) {
                    const link = el("a", "pregame-player-link", item.name);
                    link.href = item.gameUrl;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    name.append(link);
                } else {
                    name.textContent = item.name;
                }
                row.append(name);
            });
            inactive.append(row);
        });
        layout.append(tables);
        if (inactive.childElementCount) layout.append(inactive);
        wrapper.append(layout);
        return wrapper;
    };

    const getPlayerGameLog = async (playerId, season, group) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}&gameType=R`,
            `pregame:log:${playerId}:${season}:${group}`
        );
        return payload?.stats?.[0]?.splits ?? [];
    };

    const getPlayerCareerGameLog = async (person, date, group) => {
        const debutDate = String(person?.mlbDebutDate ?? "");
        const startDate = /^\d{4}-\d{2}-\d{2}$/.test(debutDate)
            ? debutDate
            : `${String(date).slice(0, 4)}-01-01`;
        const endDate = previousDate(date);
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${person.id}/stats?stats=gameLog&group=${group}&gameType=R` +
            `&startDate=${startDate}&endDate=${endDate}`,
            `pregame:career-log:${person.id}:${group}:${endDate}`
        );
        return payload?.stats?.[0]?.splits ?? [];
    };

    const getPlayerSeasonStatsBeforeDate = async (playerId, season, group, date) => {
        const endDate = previousDate(date);
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?stats=byDateRange&group=${group}&gameType=R` +
            `&startDate=${season}-01-01&endDate=${endDate}`,
            `pregame:season-before:${playerId}:${season}:${group}:${date}`
        );
        return payload?.stats?.[0]?.splits?.[0]?.stat ?? {};
    };

    const getPlayerRispAverage = async (playerId, date, startDate) => {
        const endDate = previousDate(date);
        const firstSeason = Number(String(startDate).slice(0, 4));
        const lastSeason = Number(String(endDate).slice(0, 4));
        if (!Number.isFinite(firstSeason) || !Number.isFinite(lastSeason)) return null;
        const seasons = Array.from(
            { length: Math.max(0, lastSeason - firstSeason + 1) },
            (_value, index) => firstSeason + index
        );
        const splits = await Promise.all(seasons.map(async (season) => {
            const params = new URLSearchParams({
                stats: "statSplits",
                group: "hitting",
                gameType: "R",
                sitCodes: "risp",
                season: String(season)
            });
            const payload = await fetchJson(
                `${API_ROOT}/v1/people/${playerId}/stats?${params}`,
                `pregame:risp-season:${playerId}:${season}`
            ).catch(() => null);
            return payload?.stats?.[0]?.splits?.[0]?.stat ?? null;
        }));
        const totals = splits.filter(Boolean).reduce((result, stat) => {
            result.atBats += statNumber(stat?.atBats);
            result.hits += statNumber(stat?.hits);
            return result;
        }, { atBats: 0, hits: 0 });
        return totals.atBats ? totals.hits / totals.atBats : null;
    };

    const getPlayerRispStatsBySeason = async (playerId, date, startDate) => {
        const endDate = previousDate(date);
        const firstSeason = Number(String(startDate).slice(0, 4));
        const lastSeason = Number(String(endDate).slice(0, 4));
        if (!Number.isFinite(firstSeason) || !Number.isFinite(lastSeason)) return new Map();
        const seasons = Array.from(
            { length: Math.max(0, lastSeason - firstSeason + 1) },
            (_value, index) => firstSeason + index
        );
        const entries = await Promise.all(seasons.map(async (season) => {
            const params = new URLSearchParams({
                stats: "statSplits",
                group: "hitting",
                gameType: "R",
                sitCodes: "risp",
                season: String(season)
            });
            const payload = await fetchJson(
                `${API_ROOT}/v1/people/${playerId}/stats?${params}`,
                `pregame:risp-season:${playerId}:${season}`
            ).catch(() => null);
            const stats = (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? []);
            const atBats = stats.reduce((sum, split) => sum + statNumber(split?.stat?.atBats), 0);
            const hits = stats.reduce((sum, split) => sum + statNumber(split?.stat?.hits), 0);
            return [season, stats.length ? { atBats, hits } : null];
        }));
        return new Map(entries.filter(([_season, stats]) => stats));
    };

    const HITTING_TOTAL_FIELDS = [
        "gamesPlayed", "atBats", "hits", "homeRuns", "rbi", "stolenBases",
        "doubles", "triples", "baseOnBalls", "hitByPitch", "strikeOuts",
        "sacBunts", "sacFlies", "totalBases"
    ];

    const aggregateOfficialHittingSplits = (splits) => {
        if (!splits.length) return null;
        if (splits.length === 1) return { ...splits[0].stat };
        const totals = {};
        HITTING_TOTAL_FIELDS.forEach((field) => {
            totals[field] = splits.reduce(
                (sum, split) => sum + statNumber(split?.stat?.[field]),
                0
            );
        });
        totals.avg = totals.atBats ? totals.hits / totals.atBats : 0;
        const derivedTotalBases = totals.hits + totals.doubles +
            (2 * totals.triples) + (3 * totals.homeRuns);
        totals.slg = totals.atBats
            ? (totals.totalBases || derivedTotalBases) / totals.atBats
            : 0;
        return totals;
    };

    const getPlayerYearByYearBatting = async (playerId) => {
        const params = new URLSearchParams({
            stats: "yearByYear",
            group: "hitting",
            gameType: "R",
            sportIds: "1"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?${params}`,
            `pregame:year-by-year-hitting:${playerId}`
        );
        const bySeason = new Map();
        (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? []).forEach((split) => {
            const season = Number(split?.season);
            if (!Number.isFinite(season) || !split?.stat) return;
            if (!bySeason.has(season)) bySeason.set(season, []);
            bySeason.get(season).push(split);
        });
        return new Map([...bySeason.entries()]
            .map(([season, splits]) => [season, aggregateOfficialHittingSplits(splits)]));
    };

    const PITCHING_TOTAL_FIELDS = [
        "gamesPlayed", "gamesStarted", "wins", "losses", "completeGames",
        "shutouts", "saves", "runs", "earnedRuns", "homeRuns",
        "baseOnBalls", "hitBatsmen", "strikeOuts", "hits"
    ];

    const aggregateOfficialPitchingSplits = (splits) => {
        if (!splits.length) return null;
        if (splits.length === 1) return { ...splits[0].stat };
        const totals = { outs: 0 };
        PITCHING_TOTAL_FIELDS.forEach((field) => {
            totals[field] = splits.reduce(
                (sum, split) => sum + statNumber(split?.stat?.[field]),
                0
            );
        });
        totals.outs = splits.reduce(
            (sum, split) => sum + inningsToOuts(split?.stat?.inningsPitched),
            0
        );
        totals.inningsPitched = formatInnings(totals.outs);
        totals.era = totals.outs ? (totals.earnedRuns * 27) / totals.outs : 0;
        totals.whip = totals.outs
            ? ((totals.hits + totals.baseOnBalls) * 3) / totals.outs
            : 0;
        return totals;
    };

    const getPlayerYearByYearPitching = async (playerId) => {
        const params = new URLSearchParams({
            stats: "yearByYear",
            group: "pitching",
            gameType: "R",
            sportIds: "1"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?${params}`,
            `pregame:year-by-year-pitching:${playerId}`
        );
        const bySeason = new Map();
        (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? [])
            .filter((split) => Number(split?.sport?.id) === 1)
            .forEach((split) => {
                const season = Number(split?.season);
                if (!Number.isFinite(season) || !split?.stat) return;
                if (!bySeason.has(season)) bySeason.set(season, []);
                bySeason.get(season).push(split);
            });
        return new Map([...bySeason.entries()]
            .map(([season, splits]) => [season, aggregateOfficialPitchingSplits(splits)]));
    };

    const getPlayerYearByYearErrors = async (playerId) => {
        const params = new URLSearchParams({
            stats: "yearByYear",
            group: "fielding",
            gameType: "R",
            sportIds: "1"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?${params}`,
            `pregame:year-by-year-fielding-v2:${playerId}`
        ).catch(() => null);
        const bySeason = new Map();
        (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? [])
            .filter((split) => Number(split?.sport?.id) === 1)
            .forEach((split) => {
            const season = Number(split?.season);
            if (!Number.isFinite(season) || split?.stat?.errors == null) return;
            bySeason.set(season, (bySeason.get(season) ?? 0) + statNumber(split.stat.errors));
        });
        return bySeason;
    };

    const getPlayerFieldingErrorsBeforeDate = async (playerId, season, date) => {
        const endDate = previousDate(date);
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?stats=byDateRange&group=fielding&gameType=R` +
            `&sportIds=1&startDate=${season}-01-01&endDate=${endDate}`,
            `pregame:fielding-before-v2:${playerId}:${season}:${date}`
        ).catch(() => null);
        const splits = (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? [])
            .filter((split) => Number(split?.sport?.id) === 1 && split?.stat?.errors != null);
        return splits.length
            ? splits.reduce((sum, split) => sum + statNumber(split.stat.errors), 0)
            : null;
    };

    const getPlayerCareer = async (person, group, date) => {
        const debut = String(person?.mlbDebutDate ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) return null;
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${person.id}/stats?stats=byDateRange&group=${group}` +
            `&gameType=R&sportIds=1&startDate=${debut}&endDate=${date}`,
            `pregame:career-mlb-total-v2:${person.id}:${group}:${date}`
        );
        const splits = (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? []);
        const mlbTotal = splits.find((split) =>
            !split?.team && Number(split?.sport?.id) === 0
        );
        if (mlbTotal?.stat) return mlbTotal.stat;

        const additiveFields = group === "pitching"
            ? PITCHING_TOTAL_FIELDS
            : [
                "gamesPlayed", "atBats", "hits", "homeRuns", "rbi", "stolenBases",
                "doubles", "triples", "baseOnBalls", "hitByPitch", "strikeOuts",
                "sacBunts", "sacFlies", "totalBases"
            ];
        const teamSplits = splits.filter((split) =>
            Number(split?.sport?.id) === 1 && Boolean(split?.team?.id)
        );
        if (!teamSplits.length) return null;
        const totals = teamSplits.reduce((result, split) => {
            additiveFields.forEach((field) => {
                result[field] = (result[field] ?? 0) + statNumber(split?.stat?.[field]);
            });
            return result;
        }, {});
        if (group === "hitting") {
            totals.avg = totals.atBats ? totals.hits / totals.atBats : 0;
            const derivedTotalBases = totals.hits + totals.doubles +
                (2 * totals.triples) + (3 * totals.homeRuns);
            totals.slg = totals.atBats
                ? (totals.totalBases || derivedTotalBases) / totals.atBats
                : 0;
        } else {
            const outs = teamSplits.reduce(
                (sum, split) => sum + inningsToOuts(split?.stat?.inningsPitched),
                0
            );
            totals.inningsPitched = formatInnings(outs);
            totals.era = outs ? (totals.earnedRuns * 27) / outs : 0;
            totals.whip = outs
                ? ((totals.hits + totals.baseOnBalls) * 3) / outs
                : 0;
        }
        return totals;
    };

    const collectArticles = (content) => {
        const articles = [];
        const seen = new Set();
        const visit = (value) => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (value.type === "article" && value.headline && value.slug) {
                const supplied = String(value.url ?? "");
                let url = "";
                for (const candidate of [supplied, `/news/${value.slug}`]) {
                    try {
                        const parsed = new URL(candidate, "https://www.mlb.com");
                        if (parsed.protocol === "https:" &&
                            (parsed.hostname === "mlb.com" || parsed.hostname.endsWith(".mlb.com"))) {
                            url = parsed.href;
                            break;
                        }
                    } catch (_error) {
                        // Try the canonical MLB.com news slug next.
                    }
                }
                if (url && !seen.has(url)) {
                    seen.add(url);
                    articles.push({ ...value, url });
                }
            }
            Object.values(value).forEach(visit);
        };
        visit(content?.editorial);
        return articles.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    };

    const getGameArticles = async (gamePk) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/game/${gamePk}/content`,
            `pregame:content:${gamePk}`
        ).catch(() => null);
        return collectArticles(payload);
    };

    const articleMlbDate = (article) => {
        const value = String(article?.contentDate ?? article?.date ?? "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        const timestamp = new Date(value);
        if (!Number.isFinite(timestamp.getTime())) return "";
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(timestamp);
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    };

    const relevantLatestNews = (teams, rosterEntries, date, gamePk) => {
        const teamIds = new Set(teams.map((team) => Number(team?.id)).filter(Boolean));
        const playerIds = new Set(
            rosterEntries.map((entry) => Number(entry?.person?.id ?? entry?.personId)).filter(Boolean)
        );
        return (window.MLB_LATEST_NEWS ?? []).filter((article) => {
            const isRelevant = article.teamIds?.some((id) => teamIds.has(Number(id))) ||
                article.playerIds?.some((id) => playerIds.has(Number(id)));
            if (!isRelevant) return false;
            const taggedGames = (article.gamePks ?? []).map(Number).filter(Number.isFinite);
            if (taggedGames.length) return taggedGames.includes(Number(gamePk));
            return articleMlbDate(article) === date;
        }).sort((a, b) => String(b.contentDate).localeCompare(String(a.contentDate)));
    };

    const mergeOfficialArticles = (...groups) => {
        const seen = new Set();
        return groups.flat().filter((article) => {
            const key = String(article?.url ?? article?.slug ?? "");
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const getRecentTeamTransactions = async (teams, date) => {
        const teamIds = teams.map((team) => Number(team?.id)).filter(Boolean);
        if (!teamIds.length) return [];
        let startDate = date;
        for (let count = 0; count < 3; count += 1) startDate = previousDate(startDate);
        const params = new URLSearchParams({
            teamId: teamIds.join(","),
            startDate,
            endDate: date
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/transactions?${params}`,
            `pregame:transactions:${teamIds.sort((a, b) => a - b).join("-")}:${startDate}:${date}`
        ).catch(() => null);
        const seen = new Set();
        return (payload?.transactions ?? []).flatMap((transaction) => {
            const identity = `${transaction?.id ?? ""}:${transaction?.description ?? ""}`;
            if (seen.has(identity)) return [];
            seen.add(identity);
            const person = transaction?.person ?? {};
            const relevantTeam = teams.find((team) =>
                Number(team?.id) === Number(transaction?.toTeam?.id) ||
                Number(team?.id) === Number(transaction?.fromTeam?.id)
            );
            const code = teamCode(relevantTeam);
            const description = String(transaction?.description ?? "");
            const typeCode = String(transaction?.typeCode ?? "").toUpperCase();
            let action = "ロースター異動";
            if (typeCode === "TR") action = "トレード";
            else if (/injured list/i.test(description)) {
                const days = description.match(/(\d+)-day injured list/i)?.[1];
                action = `${days ? `${days}日間` : ""}IL入り`;
            } else if (typeCode === "CU") action = "メジャー昇格";
            else if (typeCode === "OPT") action = "マイナー降格";
            else if (typeCode === "ASG" && /rehab/i.test(description)) action = "リハビリ出場開始";
            else if (typeCode === "OUT") action = "アウトライト";
            else if (/designated for assignment/i.test(description)) action = "DFA";
            else if (/signed/i.test(description)) action = "契約";
            const transactionDate = String(transaction?.effectiveDate ?? transaction?.date ?? date);
            const headline = `${compactDate(transactionDate)}　${code}　` +
                `${person?.id ? playerName(person) : "球団発表"}　${action}`;
            return [{
                headline,
                date: transactionDate,
                url: `https://www.mlb.com/transactions?date=${transactionDate}`,
                officialTransaction: true,
                personId: Number(person?.id) || null,
                personDisplayName: person?.id ? playerName(person) : "球団発表",
                teamDisplayCode: code,
                action
            }];
        }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    };

    const translateInjuryReason = (description) => {
        const reason = String(description ?? "").split(/injured list\.\s*/i)[1] ?? "";
        if (!reason) return "";
        const replacements = [
            [/right shoulder/gi, "右肩"], [/left shoulder/gi, "左肩"],
            [/right elbow/gi, "右肘"], [/left elbow/gi, "左肘"],
            [/right forearm/gi, "右前腕"], [/left forearm/gi, "左前腕"],
            [/right wrist/gi, "右手首"], [/left wrist/gi, "左手首"],
            [/right hand/gi, "右手"], [/left hand/gi, "左手"],
            [/right hamstring/gi, "右ハムストリング"], [/left hamstring/gi, "左ハムストリング"],
            [/right knee/gi, "右膝"], [/left knee/gi, "左膝"],
            [/right ankle/gi, "右足首"], [/left ankle/gi, "左足首"],
            [/right foot/gi, "右足"], [/left foot/gi, "左足"],
            [/lower back/gi, "腰"], [/back/gi, "背中"],
            [/groin/gi, "鼠径部"], [/calf/gi, "ふくらはぎ"],
            [/oblique/gi, "脇腹"], [/abdominal/gi, "腹部"],
            [/inflammation/gi, "炎症"], [/tendinitis/gi, "腱炎"],
            [/strain/gi, "筋損傷"], [/sprain/gi, "捻挫"],
            [/soreness/gi, "痛み"], [/tightness/gi, "張り"],
            [/fracture/gi, "骨折"], [/contusion/gi, "打撲"]
        ];
        let translated = reason.replace(/\.$/, "");
        replacements.forEach(([pattern, value]) => { translated = translated.replace(pattern, value); });
        return /[a-z]{4,}/i.test(translated) ? "" : translated;
    };

    const getTeamInjuryReports = async (teams, date) => {
        const teamIds = teams.map((team) => Number(team?.id)).filter(Boolean);
        if (!teamIds.length) return [];
        const season = date.slice(0, 4);
        const params = new URLSearchParams({
            teamId: teamIds.join(","),
            startDate: `${season}-01-01`,
            endDate: date
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/transactions?${params}`,
            `pregame:injury-history:${teamIds.sort((a, b) => a - b).join("-")}:${date}`
        ).catch(() => null);
        const statusByPlayer = new Map();
        (payload?.transactions ?? []).sort((a, b) =>
            String(a?.effectiveDate ?? a?.date ?? "").localeCompare(
                String(b?.effectiveDate ?? b?.date ?? "")
            )
        ).forEach((transaction) => {
            const playerId = Number(transaction?.person?.id);
            if (!playerId) return;
            const description = String(transaction?.description ?? "");
            const eventDate = String(transaction?.effectiveDate ?? transaction?.date ?? date);
            if (/placed .* on the (?:\d+-day )?injured list/i.test(description) ||
                /transferred .* to the \d+-day injured list/i.test(description)) {
                const days = description.match(/(\d+)-day injured list/i)?.[1];
                const relevantTeam = teams.find((team) =>
                    Number(team?.id) === Number(transaction?.toTeam?.id) ||
                    Number(team?.id) === Number(transaction?.fromTeam?.id)
                );
                statusByPlayer.set(playerId, {
                    person: transaction.person,
                    team: relevantTeam,
                    eventDate,
                    status: `${days ? `${days}日間` : ""}IL`,
                    reason: translateInjuryReason(description)
                });
                return;
            }
            if (/rehab assignment/i.test(description) && statusByPlayer.has(playerId)) {
                statusByPlayer.get(playerId).status = "リハビリ出場中";
                statusByPlayer.get(playerId).eventDate = eventDate;
                return;
            }
            if (/reinstated|activated .* from the .*injured list/i.test(description)) {
                statusByPlayer.delete(playerId);
            }
        });
        return [...statusByPlayer.values()].map((injury) => ({
            headline: `${teamCode(injury.team)}　${playerName(injury.person)}　${injury.status}` +
                (injury.reason ? `（${injury.reason}）` : ""),
            date: injury.eventDate,
            url: "https://www.mlb.com/injury-report",
            officialInjury: true
        }));
    };

    const articleHasPlayer = (article, playerId) => (article?.keywordsAll ?? []).some((keyword) => {
        const value = String(keyword?.value ?? "");
        return (keyword?.type === "player" && value === `playerid-${playerId}`) ||
            (keyword?.type === "player_id" && value === String(playerId));
    });

    const articleHasTeam = (article, teamId) => (article?.keywordsAll ?? []).some((keyword) => {
        const value = String(keyword?.value ?? "");
        return keyword?.type === "team" && value === `teamid-${teamId}`;
    });

    const statNumber = (value) => Number(value) || 0;

    const inningsToOuts = (value) => {
        const [whole, partial = "0"] = String(value ?? "0").split(".");
        return statNumber(whole) * 3 + Math.min(2, statNumber(partial));
    };

    const formatInnings = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

    const aggregateHitting = (splits) => {
        const totals = splits.reduce((sum, split) => {
            const stat = split?.stat ?? {};
            ["atBats", "hits", "homeRuns", "rbi", "runs", "stolenBases", "baseOnBalls", "hitByPitch", "sacFlies", "totalBases"]
                .forEach((field) => { sum[field] += statNumber(stat[field]); });
            return sum;
        }, { atBats: 0, hits: 0, homeRuns: 0, rbi: 0, runs: 0, stolenBases: 0, baseOnBalls: 0, hitByPitch: 0, sacFlies: 0, totalBases: 0 });
        const avg = totals.atBats ? totals.hits / totals.atBats : 0;
        const obpDenominator = totals.atBats + totals.baseOnBalls + totals.hitByPitch + totals.sacFlies;
        const obp = obpDenominator
            ? (totals.hits + totals.baseOnBalls + totals.hitByPitch) / obpDenominator
            : 0;
        const slg = totals.atBats ? totals.totalBases / totals.atBats : 0;
        return { ...totals, avg, ops: obp + slg };
    };

    const aggregatePitching = (splits) => {
        const totals = splits.reduce((sum, split) => {
            const stat = split?.stat ?? {};
            sum.outs += inningsToOuts(stat.inningsPitched);
            ["runs", "earnedRuns", "strikeOuts", "baseOnBalls", "hits", "wins", "losses", "saves"]
                .forEach((field) => { sum[field] += statNumber(stat[field]); });
            return sum;
        }, { outs: 0, runs: 0, earnedRuns: 0, strikeOuts: 0, baseOnBalls: 0, hits: 0, wins: 0, losses: 0, saves: 0 });
        return {
            ...totals,
            innings: formatInnings(totals.outs),
            era: totals.outs ? totals.earnedRuns * 27 / totals.outs : 0
        };
    };

    const getHittingStreaks = (splits) => {
        const ordered = [...splits].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const createStreak = () => ({ count: 0, startDate: "", endDate: "", noPlateAppearanceGames: [] });
        const streaks = {
            hits: createStreak(),
            onBase: createStreak(),
            rbi: createStreak()
        };
        const updateStreak = (streak, succeeded, date) => {
            if (!succeeded) {
                Object.assign(streak, createStreak());
                return;
            }
            if (!streak.count) streak.startDate = date;
            streak.count += 1;
            streak.endDate = date;
        };
        ordered.forEach((split) => {
            const stat = split?.stat ?? {};
            const pa = statNumber(stat.plateAppearances) ||
                statNumber(stat.atBats) + statNumber(stat.baseOnBalls) + statNumber(stat.hitByPitch);
            if (!pa) {
                if (statNumber(stat.gamesPlayed) > 0) {
                    Object.values(streaks).forEach((streak) => {
                        if (!streak.count) return;
                        streak.noPlateAppearanceGames.push({
                            date: String(split?.date ?? ""),
                            fieldingOnly: Array.isArray(split?.positionsPlayed) && split.positionsPlayed.length > 0
                        });
                    });
                }
                return;
            }
            const date = String(split?.date ?? "");
            updateStreak(streaks.hits, statNumber(stat.hits) > 0, date);
            updateStreak(
                streaks.onBase,
                statNumber(stat.hits) + statNumber(stat.baseOnBalls) + statNumber(stat.hitByPitch) > 0,
                date
            );
            updateStreak(streaks.rbi, statNumber(stat.rbi) > 0, date);
        });
        return streaks;
    };

    const formatHittingStreak = (streak, label) => {
        const period = streak.startDate
            ? ` ${compactDate(streak.startDate)}〜`
            : "";
        const annotationDates = new Map();
        streak.noPlateAppearanceGames
            .filter((game) => game.date >= streak.startDate && game.date <= streak.endDate)
            .forEach((game) => {
                const annotation = game.fieldingOnly ? "守備のみ出場" : "打席なし";
                if (!annotationDates.has(annotation)) annotationDates.set(annotation, new Set());
                annotationDates.get(annotation).add(compactDate(game.date));
            });
        const annotations = [...annotationDates.entries()].map(([annotation, dates]) =>
            `${[...dates].join("、")}は${annotation}`
        );
        return `${streak.count}試合連続${label}${period}` +
            (annotations.length ? `（${annotations.join("、")}）` : "");
    };

    const getQualityStartStreak = (splits) => {
        const starts = [...splits]
            .filter((split) => statNumber(split?.stat?.gamesStarted) > 0)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        let streak = 0;
        for (let index = starts.length - 1; index >= 0; index -= 1) {
            const stat = starts[index]?.stat ?? {};
            const isQualityStart = inningsToOuts(stat.inningsPitched) >= 18 &&
                statNumber(stat.earnedRuns) <= 3;
            if (!isQualityStart) break;
            streak += 1;
        }
        return streak;
    };

    const getPitchingScorelessStreak = (splits) => {
        const appearances = [...splits]
            .filter((split) => inningsToOuts(split?.stat?.inningsPitched) > 0)
            .sort((left, right) => String(right?.date ?? "").localeCompare(String(left?.date ?? "")));
        if (!appearances.length) return null;

        const starts = appearances.filter((split) => statNumber(split?.stat?.gamesStarted) > 0).length;
        const reliefAppearances = appearances.length - starts;
        const starterRole = starts > reliefAppearances ||
            (starts === reliefAppearances && statNumber(appearances[0]?.stat?.gamesStarted) > 0);
        let games = 0;
        let outs = 0;
        let startDate = "";
        for (const appearance of appearances) {
            const stat = appearance?.stat ?? {};
            if (stat.runs == null || statNumber(stat.runs) > 0) break;
            games += 1;
            outs += inningsToOuts(stat.inningsPitched);
            startDate = String(appearance?.date ?? "").slice(0, 10);
        }
        const period = startDate ? `（${compactDate(startDate)}〜）` : "";
        if (starterRole && outs >= 27) {
            const innings = outs % 3 === 0 ? String(outs / 3) : formatInnings(outs);
            return { text: `${innings}回連続無失点${period}`, value: outs };
        }
        if (!starterRole && games >= 3) {
            return { text: `${games}試合連続無失点${period}`, value: games * 3 };
        }
        return null;
    };

    const remainingMilestones = (career, group) => {
        if (!career) return [];
        const definitions = group === "pitching"
            ? [
                ["wins", "勝", [50, 100, 150, 200, 250, 300]],
                ["strikeOuts", "奪三振", [500, 1000, 1500, 2000, 2500, 3000]],
                ["gamesPlayed", "登板", [100, 250, 500, 750, 1000]],
                ["saves", "セーブ", [50, 100, 150, 200, 250, 300, 400, 500]]
            ]
            : [
                ["hits", "安打", [500, 1000, 1500, 2000, 2500, 3000]],
                ["homeRuns", "本塁打", [100, 200, 300, 400, 500, 600, 700]],
                ["rbi", "打点", [500, 1000, 1500, 2000]],
                ["stolenBases", "盗塁", [100, 200, 300, 400, 500]]
            ];
        return definitions.flatMap(([field, label, marks]) => {
            const total = statNumber(career[field]);
            const next = marks.find((mark) => mark > total);
            const remaining = next ? next - total : 0;
            return remaining >= 1 && remaining <= 5
                ? [`通算${next}${label}まであと${remaining}`]
                : [];
        });
    };

    const getAllTimeStrikeoutCountdown = async (career, playerId) => {
        const total = Number(career?.strikeOuts);
        if (!Number.isFinite(total)) return null;

        const params = new URLSearchParams({
            leaderCategories: "strikeouts",
            statGroup: "pitching",
            statType: "career",
            sportId: "1",
            limit: "15"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/stats/leaders?${params}`,
            "pregame:all-time-pitching-strikeout-leaders"
        ).catch(() => null);
        const leaders = (payload?.leagueLeaders?.[0]?.leaders ?? [])
            .map((leader) => ({
                rank: Number(leader?.rank),
                playerId: Number(leader?.person?.id),
                value: Number(leader?.value)
            }))
            .filter((leader) =>
                Number.isFinite(leader.rank) && Number.isFinite(leader.value)
            );
        if (!leaders.length) return null;

        const officialPlayer = leaders.find((leader) => leader.playerId === Number(playerId));
        let targetRank;
        let targetValue;

        // When reopening the pregame page for the game in which the rank was
        // reached, the live all-time list can already contain the postgame total.
        if (officialPlayer?.rank <= 10 && officialPlayer.value > total) {
            targetRank = officialPlayer.rank;
            targetValue = officialPlayer.value;
        } else if (officialPlayer?.rank <= 10) {
            const nextRank = officialPlayer.rank - 1;
            const nextLeader = leaders.find((leader) => leader.rank === nextRank);
            if (!nextLeader) return null;
            targetRank = nextRank;
            targetValue = nextLeader.value + 1;
        } else {
            const tenth = leaders.find((leader) => leader.rank === 10);
            if (!tenth) return null;
            targetRank = 10;
            targetValue = tenth.value + 1;
        }

        const remaining = targetValue - total;
        return remaining >= 1 && remaining <= 5
            ? `MLB歴代${targetRank}位となる${targetValue}奪三振まであと${remaining}`
            : null;
    };

    const setLoading = (loading) => {
        dom.loading.hidden = !loading;
    };

    const syncDateControl = (date) => {
        const normalizedDate = String(date ?? "").slice(0, 10);
        if (dom.dateInput) dom.dateInput.value = normalizedDate;
        if (dom.mobileDateDisplay) {
            dom.mobileDateDisplay.textContent = normalizedDate.replaceAll("-", "/");
        }
    };

    const setHeader = (title, subtitle) => {
        dom.title.parentElement?.classList.remove("pregame-matchup-title-block");
        dom.title.className = "";
        dom.title.textContent = title;
        dom.subtitle.className = "";
        dom.subtitle.textContent = subtitle;
    };

    const setPlayerHeader = (person, team, date) => {
        dom.title.parentElement?.classList.remove("pregame-matchup-title-block");
        dom.title.className = "";
        const name = playerName(person);
        if (person?.id) {
            const link = el("a", "pregame-player-title-link", name);
            link.href = `https://www.mlb.com/player/${person.id}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            dom.title.replaceChildren(link);
        } else {
            dom.title.textContent = name;
        }
        dom.subtitle.textContent = `${teamCode(team)} / ${formatDate(date)} 試合前時点`;
    };

    const divisionJapaneseLabel = (division) => ({
        "American League East": "アメリカンリーグ東部地区",
        "American League Central": "アメリカンリーグ中部地区",
        "American League West": "アメリカンリーグ西部地区",
        "National League East": "ナショナルリーグ東部地区",
        "National League Central": "ナショナルリーグ中部地区",
        "National League West": "ナショナルリーグ西部地区"
    })[String(division ?? "")] ?? String(division ?? "所属地区未確定");

    const getStandingsSnapshot = async (date) => {
        const standingsDate = previousDate(date);
        const season = date.slice(0, 4);
        const params = new URLSearchParams({
            leagueId: "103,104",
            season,
            standingsTypes: "regularSeason",
            date: standingsDate,
            hydrate: "division,team,league"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/standings?${params}`,
            `pregame:standings:${standingsDate}`
        ).catch(() => null);
        const standings = new Map();
        (payload?.records ?? []).forEach((record) => {
            const divisionTeams = record?.teamRecords ?? [];
            const secondPlace = divisionTeams.find((teamRecord) =>
                Number.parseInt(teamRecord?.divisionRank, 10) === 2
            ) ?? divisionTeams[1] ?? null;
            divisionTeams.forEach((teamRecord) => {
                standings.set(Number(teamRecord?.team?.id), {
                    division: divisionJapaneseLabel(record?.division?.name ?? teamRecord?.team?.division?.name),
                    rank: Number.parseInt(teamRecord?.divisionRank, 10),
                    wins: Number.parseInt(teamRecord?.wins, 10),
                    losses: Number.parseInt(teamRecord?.losses, 10),
                    leagueCode: Number(record?.division?.league?.id ?? teamRecord?.team?.league?.id) === 104
                        ? "NL"
                        : "AL",
                    wildCardRank: Number.parseInt(teamRecord?.wildCardRank, 10),
                    divisionLeader: teamRecord?.divisionLeader === true ||
                        Number.parseInt(teamRecord?.divisionRank, 10) === 1,
                    secondPlaceTeam: secondPlace?.team ?? null,
                    secondPlaceGamesBack: secondPlace?.divisionGamesBack ?? secondPlace?.gamesBack ?? null
                });
            });
        });
        return standings;
    };

    const formatStandingsGap = (value) => {
        const text = String(value ?? "").trim();
        if (!text || text === "-" || text === "—") return "0.0";
        const number = Number.parseFloat(text.replace("+", ""));
        return Number.isFinite(number) ? number.toFixed(1) : text;
    };

    const wildCardLine = (standing) => {
        if (!standing) return "順位未確定";
        if (standing.divisionLeader) {
            const opponent = standing.secondPlaceTeam
                ? teamJapaneseShortName(standing.secondPlaceTeam)
                : "2位チーム";
            return `同地区2位 ${opponent}と${formatStandingsGap(standing.secondPlaceGamesBack)}差`;
        }
        const rank = Number.isFinite(standing.wildCardRank)
            ? `${standing.wildCardRank}位`
            : "順位未確定";
        return `${standing.leagueCode}ワイルドカード ${rank}`;
    };

    const shouldShowWildCard = (officialDate) => {
        const match = String(officialDate ?? "").match(/^\d{4}-(\d{2})-(\d{2})$/);
        if (!match) return false;
        return Number(match[1]) >= 8;
    };

    const wildCardLink = (standing) => {
        const wrapper = el("small", "pregame-header-wild-card");
        const link = el("a", "pregame-header-wild-card-link", wildCardLine(standing));
        link.href = "https://www.mlb.com/standings/wild-card";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${wildCardLine(standing)}：MLB公式順位表を開く`);
        wrapper.append(link);
        return wrapper;
    };

    const isDesktopGameDetailLayout = () =>
        navigator.maxTouchPoints === 0 &&
        window.matchMedia("screen and (min-width: 1101px) and (hover: hover) and (pointer: fine)").matches;

    const getTeamRecordsBeforeGame = (standings, sameDayGames, gamePk, gameDateTime, teamIds) => {
        const records = new Map(teamIds.map((teamId) => {
            const standing = standings.get(Number(teamId));
            const wins = Number(standing?.wins);
            const losses = Number(standing?.losses);
            return [Number(teamId), Number.isFinite(wins) && Number.isFinite(losses) ? { wins, losses } : null];
        }));
        const targetStart = Date.parse(String(gameDateTime ?? ""));
        if (!Number.isFinite(targetStart)) return records;
        sameDayGames.forEach((entry) => {
            if (Number(entry?.gamePk) === Number(gamePk) || !isFinal(entry)) return;
            const gameStart = Date.parse(String(entry?.gameDate ?? ""));
            if (!Number.isFinite(gameStart) || gameStart >= targetStart) return;
            const away = entry?.teams?.away ?? {};
            const home = entry?.teams?.home ?? {};
            const awayId = Number(away?.team?.id);
            const homeId = Number(home?.team?.id);
            if (!records.has(awayId) && !records.has(homeId)) return;
            const awayScore = Number(away?.score);
            const homeScore = Number(home?.score);
            const winnerId = away?.isWinner === true || (Number.isFinite(awayScore) && awayScore > homeScore)
                ? awayId
                : home?.isWinner === true || (Number.isFinite(homeScore) && homeScore > awayScore)
                    ? homeId
                    : 0;
            const loserId = winnerId === awayId ? homeId : winnerId === homeId ? awayId : 0;
            const winnerRecord = records.get(winnerId);
            const loserRecord = records.get(loserId);
            if (winnerRecord) winnerRecord.wins += 1;
            if (loserRecord) loserRecord.losses += 1;
        });
        return records;
    };

    const formatGameTime = (dateTime, timeZone) => {
        if (!dateTime) return "時刻未定";
        const value = new Date(dateTime);
        if (Number.isNaN(value.getTime())) return "時刻未定";
        return new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true
        }).format(value);
    };

    const renderSeriesStars = (team, seriesStanding, extraClass = "") => {
        const stars = el("span", `pregame-series-stars${extraClass ? ` ${extraClass}` : ""}`);
        if (!seriesStanding) return stars;
        const wins = seriesStanding.wins.get(Number(team?.id)) ?? 0;
        for (let index = 0; index < seriesStanding.totalGames; index += 1) {
            stars.append(el("span", index < wins ? "pregame-series-star won" : "pregame-series-star", index < wins ? "★" : "☆"));
        }
        stars.setAttribute(
            "aria-label",
            `${teamJapaneseName(team)} このカード${seriesStanding.totalGames}試合中${wins}勝`
        );
        return stars;
    };

    const setMatchupHeader = (
        awayTeam,
        homeTeam,
        standings,
        game,
        feed,
        gamePk,
        articles,
        seriesStanding,
        pregameRecords
    ) => {
        const dateTime = feed?.gameData?.datetime?.dateTime ?? game?.gameDate;
        const officialDate = feed?.gameData?.datetime?.officialDate ??
            game?.officialDate ?? String(dateTime ?? "").slice(0, 10);
        const showWildCard = shouldShowWildCard(officialDate);
        const teamBlock = (team) => {
            const block = el("span", "pregame-header-team");
            const standing = standings.get(Number(team?.id));
            const rank = Number.isFinite(standing?.rank) ? `${standing.rank}位` : "順位未確定";
            const slug = window.MLB_SCOREBOOK_TEAM_SLUGS_BY_ID?.[Number(team?.id)];
            const teamName = el(slug ? "a" : "strong", "pregame-header-team-name", teamJapaneseName(team));
            if (slug) {
                teamName.href = `https://www.mlb.com/${slug}`;
                teamName.target = "_blank";
                teamName.rel = "noopener noreferrer";
            }
            const links = el("span", "pregame-team-official-links");
            const [xAccount, instagramAccount] = TEAM_SOCIAL_ACCOUNTS[Number(team?.id)] ?? [];
            if (xAccount) {
                const xLink = el("a", "pregame-team-social-link pregame-team-x-link");
                xLink.href = `https://x.com/${xAccount}`;
                xLink.target = "_blank";
                xLink.rel = "noopener noreferrer";
                xLink.setAttribute("aria-label", `${teamJapaneseName(team)}公式X`);
                xLink.innerHTML = '<svg class="pregame-social-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg>';
                links.append(xLink);
            }
            if (instagramAccount) {
                const instagramLink = el("a", "pregame-team-social-link pregame-team-instagram-link");
                instagramLink.href = `https://www.instagram.com/${instagramAccount}/`;
                instagramLink.target = "_blank";
                instagramLink.rel = "noopener noreferrer";
                instagramLink.setAttribute("aria-label", `${teamJapaneseName(team)}公式Instagram`);
                instagramLink.innerHTML = '<svg class="pregame-social-logo" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5.25" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="17.55" cy="6.55" r="1.25" fill="currentColor"/></svg>';
                links.append(instagramLink);
            }
            const teamArticle = articles.find((article) => articleHasTeam(article, Number(team?.id)));
            if (teamArticle?.url) {
                const articleLink = el("a", "pregame-team-social-link pregame-team-mlb-link", "MLB");
                articleLink.href = teamArticle.url;
                articleLink.target = "_blank";
                articleLink.rel = "noopener noreferrer";
                articleLink.title = teamArticle.headline;
                articleLink.setAttribute("aria-label", `${teamJapaneseName(team)}のMLB公式記事：${teamArticle.headline}`);
                links.append(articleLink);
            }
            block.append(
                teamName,
                ...(pregameRecords ? [el(
                    "span",
                    "pregame-header-record",
                    (() => {
                        const record = pregameRecords.get(Number(team?.id));
                        return record ? `${record.wins}勝${record.losses}敗` : "—";
                    })()
                )] : []),
                el("small", "", `${standing?.division ?? "所属地区未確定"}　${rank}`),
                ...(showWildCard ? [wildCardLink(standing)] : []),
                links
            );
            return block;
        };
        dom.title.className = "pregame-matchup-heading";
        if (seriesStanding) dom.title.classList.add("pregame-series-standing-active");
        if (showWildCard) dom.title.classList.add("pregame-wild-card-active");
        dom.title.parentElement?.classList.add("pregame-matchup-title-block");
        const matchupHeading = seriesStanding
            ? [
                teamBlock(awayTeam),
                renderSeriesStars(awayTeam, seriesStanding),
                el("span", "pregame-header-versus", "VS."),
                renderSeriesStars(homeTeam, seriesStanding),
                teamBlock(homeTeam)
            ]
            : [teamBlock(awayTeam), el("span", "pregame-header-versus", "VS."), teamBlock(homeTeam)];
        dom.title.replaceChildren(...matchupHeading);
        const venue = venueLabel(feed?.gameData?.venue ?? game?.venue) || "球場未定";
        dom.subtitle.className = "pregame-matchup-meta-line";
        dom.subtitle.replaceChildren(
            el("span", "pregame-matchup-date", formatDate(officialDate)),
            el("span", "pregame-matchup-venue", venue),
            el("span", "pregame-matchup-times",
                `ET ${formatGameTime(dateTime, "America/New_York")}　｜　` +
                `JST ${formatGameTime(dateTime, "Asia/Tokyo")}`
            ),
            el("button", "pregame-score-load-button", "スコア取得")
        );
        const scoreButton = dom.subtitle.querySelector(".pregame-score-load-button");
        scoreButton.type = "button";
        scoreButton.dataset.pregameScoreGame = String(gamePk);
    };

    const section = (title, subtitle = "") => {
        const wrapper = el("section", "pregame-section");
        const header = el("header", "pregame-section-header");
        header.append(el("h3", "", title));
        if (subtitle) header.append(el("span", "", subtitle));
        wrapper.append(header);
        return wrapper;
    };

    const empty = (text) => el("div", "pregame-empty", text);

    const renderArticles = (articles, emptyText = "該当するMLB・球団公式記事はありません。") => {
        const list = el("div", "pregame-article-list");
        if (!articles.length) return empty(emptyText);
        articles.slice(0, 8).forEach((article) => {
            const row = el("div", "pregame-article-row");
            const link = el("a", "", article.summaryJa || article.headline);
            link.href = article.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            if (article.summaryJa && article.headline) link.title = article.headline;
            row.append(link);
            list.append(row);
        });
        return list;
    };

    const renderTransactions = (transactions) => {
        if (!transactions.length) {
            return empty("対象期間のトレード・ロースター異動はありません。");
        }
        const list = el("div", "pregame-article-list");
        transactions.slice(0, 8).forEach((transaction) => {
            const row = el("div", "pregame-article-row pregame-transaction-row");
            row.append(el("span", "pregame-transaction-meta",
                `${compactDate(transaction.date)}　${transaction.teamDisplayCode}　`
            ));
            if (transaction.personId) {
                const playerLink = el("a", "pregame-transaction-player", transaction.personDisplayName);
                playerLink.href = `https://www.mlb.com/player/${transaction.personId}`;
                playerLink.target = "_blank";
                playerLink.rel = "noopener noreferrer";
                row.append(playerLink);
            } else {
                row.append(el("span", "pregame-transaction-player", transaction.personDisplayName));
            }
            row.append(el("span", "pregame-transaction-action", `　${transaction.action}`));
            list.append(row);
        });
        return list;
    };

    const renderTop = async () => {
        scrollPregameToTop();
        currentPlayerView = null;
        placeHeaderActions(false);
        savePregameSession("pregame-top");
        dom.view.classList.remove("pregame-player-detail-active");
        setLoading(true);
        const date = currentDate || currentMlbDate();
        syncDateControl(date);
        setHeader("試合前情報", formatDate(date));
        try {
            const season = Number(date.slice(0, 4));
            const [games, japanesePlayers] = await Promise.all([
                getSchedule(date),
                getSeasonJapanesePlayers(season)
            ]);
            const teamGame = new Map();
            const teamGames = new Map();
            games.forEach((game) => {
                [game?.teams?.away?.team, game?.teams?.home?.team].forEach((team) => {
                    if (!team?.id) return;
                    const teamId = Number(team.id);
                    teamGame.set(teamId, game);
                    if (!teamGames.has(teamId)) teamGames.set(teamId, []);
                    teamGames.get(teamId).push(game);
                });
            });
            const rosterTeamIds = [...MLB_TEAM_IDS];
            const [rosterEntries, japaneseTransactions, japaneseGameHistories] = await Promise.all([
                Promise.all(rosterTeamIds.map(async (teamId) => [
                    teamId,
                    await getActiveRosterIds(teamId, date)
                ])),
                getJapanesePlayerTransactions(japanesePlayers, season, date),
                Promise.all(japanesePlayers.map(async (person) => [
                    Number(person.id),
                    await getJapanesePlayerGameHistory(person, season, date)
                ]))
            ]);
            const activeTeamByPlayer = new Map();
            rosterEntries.forEach(([teamId, rosterIds]) => {
                rosterIds.forEach((playerId) => activeTeamByPlayer.set(Number(playerId), Number(teamId)));
            });
            const gameHistoryByPlayer = new Map(japaneseGameHistories);
            const minorTeams = await getMinorTeamDetails(japaneseTransactions);
            const todaysJapanese = japanesePlayers
                .map((person) => {
                    const rosterState = japanesePlayerTeamAtDate({
                        person,
                        date,
                        gameHistory: gameHistoryByPlayer.get(Number(person.id)) ?? [],
                        transactions: japaneseTransactions,
                        activeTeamId: activeTeamByPlayer.get(Number(person.id)) ?? null,
                        minorTeams
                    });
                    return rosterState
                        ? { ...person, pregameTeamId: rosterState.teamId, pregameRosterState: rosterState }
                        : null;
                })
                .filter(Boolean)
                .sort((a, b) => playerName(a).localeCompare(playerName(b), "ja"));
            const dashboard = el("div", "pregame-dashboard");
            const japaneseSection = section(
                "日本人選手",
                `${todaysJapanese.length}人 / 対象日までにMLB登録`
            );
            const japaneseGrid = el("div", "pregame-card-grid");
            if (!todaysJapanese.length) {
                japaneseSection.append(empty("対象日までにMLB登録された日本人選手は見つかりませんでした。"));
            } else {
                todaysJapanese.forEach((person) => {
                    const game = teamGame.get(Number(person.pregameTeamId));
                    const officialTeam = [game?.teams?.away?.team, game?.teams?.home?.team]
                        .find((team) => Number(team?.id) === Number(person.pregameTeamId))
                        ?? person.pregameRosterState?.team
                        ?? (Number(person?.currentTeam?.id) === Number(person.pregameTeamId)
                            ? person.currentTeam
                            : { id: person.pregameTeamId });
                    const card = el("button", "pregame-person-card");
                    card.type = "button";
                    card.dataset.pregamePlayer = String(person.id);
                    if (person.pregameTeamId) card.dataset.pregameTeam = String(person.pregameTeamId);
                    if (game) card.dataset.pregameGame = String(game.gamePk);
                    const rosterStatus = person.pregameRosterState?.rosterStatus;
                    const playerStatus = rosterStatus
                        ? rosterStatus
                        : (game ? japanesePlayerGameStatusLabel(game) : "試合なし");
                    card.append(
                        el("strong", "", playerName(person)),
                        el("small", "", `${teamJapaneseName(officialTeam)} / ${positionLabel(person.primaryPosition?.abbreviation)}`),
                        el(
                            "span",
                            person.pregameRosterState?.active && isLive(game)
                                ? "pregame-live-badge"
                                : "pregame-status-badge",
                            playerStatus
                        )
                    );
                    japaneseGrid.append(card);
                });
                japaneseSection.append(japaneseGrid);
            }
            dashboard.append(japaneseSection);
            dashboard.append(renderJapaneseDailyStats(
                await buildJapaneseDailyStats(todaysJapanese, teamGames)
            ));

            const gamesSection = section("全試合", `${games.length}試合`);
            gamesSection.classList.add("pregame-games-section");
            if (!games.length) {
                gamesSection.append(empty("この日のMLB公式戦は見つかりませんでした。"));
            } else {
                const createGameCard = (game) => {
                    const away = game?.teams?.away?.team ?? {};
                    const home = game?.teams?.home?.team ?? {};
                    const card = el("button", "pregame-game-card");
                    setGameCardTeamColors(card, away, home);
                    const matchupTitle = el("strong", "pregame-matchup-title");
                    matchupTitle.append(
                        document.createTextNode(teamJapaneseShortName(away)),
                        el("span", "pregame-versus", "VS."),
                        document.createTextNode(teamJapaneseShortName(home))
                    );
                    const matchupMeta = el("small", "pregame-matchup-meta");
                    const pitcherLine = el("span", "pregame-pitcher-line");
                    pitcherLine.append(
                        el(
                            "span",
                            "pregame-pitcher-name pregame-pitcher-away",
                            game?.teams?.away?.probablePitcher?.fullName
                                ? playerName(game.teams.away.probablePitcher)
                                : "未定"
                        ),
                        Object.assign(el("span", "pregame-pitcher-versus"), { ariaHidden: "true" }),
                        el(
                            "span",
                            "pregame-pitcher-name pregame-pitcher-home",
                            game?.teams?.home?.probablePitcher?.fullName
                                ? playerName(game.teams.home.probablePitcher)
                                : "未定"
                        )
                    );
                    matchupMeta.append(
                        el("span", "pregame-venue-line", venueLabel(game?.venue) || "球場未定"),
                        pitcherLine
                    );
                    card.type = "button";
                    card.dataset.pregameGame = String(game.gamePk);
                    card.append(
                        matchupTitle,
                        matchupMeta,
                        el(
                            "span",
                            isLive(game) ? "pregame-live-badge" : "pregame-status-badge",
                            gameCardStatusLabel(game)
                        )
                    );
                    return card;
                };

                const gamesByLeague = new Map();
                games.forEach((game) => {
                    const category = gameScheduleCategory(game);
                    if (!category) return;
                    if (!gamesByLeague.has(category)) gamesByLeague.set(category, []);
                    gamesByLeague.get(category).push(game);
                });

                [...gamesByLeague.entries()]
                    .sort(([left], [right]) => {
                        const leftIndex = GAME_CATEGORY_ORDER.indexOf(left);
                        const rightIndex = GAME_CATEGORY_ORDER.indexOf(right);
                        return (leftIndex < 0 ? GAME_CATEGORY_ORDER.length : leftIndex) -
                            (rightIndex < 0 ? GAME_CATEGORY_ORDER.length : rightIndex);
                    })
                    .forEach(([category, categoryGames]) => {
                        if (!categoryGames.length) return;
                        const group = el("section", "pregame-league-group");
                        const heading = el("div", "pregame-league-header");
                        heading.append(
                            el("h4", "", category),
                            el("span", "", `${categoryGames.length}試合`)
                        );
                        const grid = el("div", "pregame-card-grid pregame-league-grid");
                        categoryGames.forEach((game) => grid.append(createGameCard(game)));
                        group.append(heading, grid);
                        gamesSection.append(group);
                    });
            }
            dashboard.append(gamesSection);
            dom.content.replaceChildren(dashboard);
        } catch (error) {
            console.error(error);
            dom.content.replaceChildren(el("div", "pregame-error", error.message));
        } finally {
            setLoading(false);
        }
    };

    const getPlayerFromFeed = (feed, playerId) =>
        feed?.gameData?.players?.[`ID${playerId}`] ?? null;

    const getPlayerGameInfo = (feed, game, playerId) => {
        const sides = ["away", "home"];
        for (const side of sides) {
            const team = feed?.liveData?.boxscore?.teams?.[side] ?? {};
            const entry = team?.players?.[`ID${playerId}`];
            if (!entry) continue;
            const order = Number.parseInt(entry?.battingOrder, 10);
            const battingOrder = Number.isFinite(order) ? Math.floor(order / 100) : null;
            const probable = Number(game?.teams?.[side]?.probablePitcher?.id) === Number(playerId);
            const pitching = entry?.stats?.pitching ?? {};
            const appeared = statNumber(entry?.stats?.batting?.gamesPlayed) > 0 ||
                statNumber(pitching?.gamesPlayed) > 0 || Number.isFinite(order);
            return {
                side,
                battingOrder,
                position: entry?.position?.abbreviation ?? entry?.allPositions?.[0]?.abbreviation ?? "-",
                probable,
                appeared
            };
        }
        return null;
    };

    const metric = (label, value, linkOptions = null) => {
        const box = el("div", "pregame-metric");
        const valueElement = el(linkOptions?.href ? "a" : "strong", "pregame-metric-value", value);
        if (linkOptions?.href) {
            valueElement.href = linkOptions.href;
            valueElement.target = "_blank";
            valueElement.rel = "noopener noreferrer";
            if (linkOptions.ariaLabel) valueElement.setAttribute("aria-label", linkOptions.ariaLabel);
        }
        box.append(el("span", "", label), valueElement);
        return box;
    };

    const getOfficialTeamStatsUrl = (team, season, group) => {
        const slug = window.MLB_SCOREBOOK_TEAM_SLUGS_BY_ID?.[Number(team?.id)];
        if (!slug) return "";
        const path = group === "pitching" ? "stats/team/pitching" : "stats/team";
        const url = new URL(`https://www.mlb.com/${slug}/${path}`);
        url.searchParams.set("season", String(season));
        return url.toString();
    };

    const FRANCHISE_RECORD_CATEGORIES = Object.freeze({
        hitting: Object.freeze({
            homeRuns: "本塁打",
            hits: "安打",
            runsBattedIn: "打点",
            stolenBases: "盗塁",
            runs: "得点"
        }),
        pitching: Object.freeze({
            wins: "勝利",
            strikeouts: "奪三振",
            saves: "セーブ",
            gamesPlayed: "登板"
        })
    });

    const FRANCHISE_RECORD_FIELDS = Object.freeze({
        homeRuns: "homeRuns",
        hits: "hits",
        runsBattedIn: "rbi",
        stolenBases: "stolenBases",
        runs: "runs",
        wins: "wins",
        strikeouts: "strikeOuts",
        saves: "saves",
        gamesPlayed: "gamesPlayed"
    });

    const getOfficialFranchiseRecordsUrl = (teamId) => {
        const slug = window.MLB_SCOREBOOK_TEAM_SLUGS_BY_ID?.[Number(teamId)];
        return slug ? `https://www.mlb.com/${slug}/stats/all-time-totals` : "";
    };

    const getFranchiseLeaders = async (teamId) => {
        const numericTeamId = Number(teamId);
        if (!Number.isFinite(numericTeamId)) return [];
        const groups = await Promise.all(Object.entries(FRANCHISE_RECORD_CATEGORIES)
            .map(async ([group, categories]) => {
                const params = new URLSearchParams({
                    leaderCategories: Object.keys(categories).join(","),
                    statGroup: group,
                    statType: "career",
                    sportId: "1",
                    teamId: String(numericTeamId),
                    limit: "16"
                });
                const payload = await fetchJson(
                    `${API_ROOT}/v1/stats/leaders?${params}`,
                    `pregame:franchise-leaders:${numericTeamId}:${group}`
                ).catch(() => null);
                return (payload?.leagueLeaders ?? []).flatMap((category) =>
                    (category?.leaders ?? []).map((leader) => ({
                        group,
                        category: String(category?.leaderCategory ?? ""),
                        label: categories[category?.leaderCategory] ?? "",
                        rank: Number(leader?.rank),
                        value: Number(leader?.value),
                        playerId: Number(leader?.person?.id)
                    }))
                );
            }));
        return groups.flat().filter((leader) =>
            leader.label && leader.rank >= 1 && leader.rank <= 16 &&
            Number.isFinite(leader.playerId) && Number.isFinite(leader.value)
        );
    };

    const getPlayerFranchiseStatsBeforeDate = async (person, teamId, group, date) => {
        const playerId = Number(person?.id);
        const numericTeamId = Number(teamId);
        const debutDate = String(person?.mlbDebutDate ?? "");
        const endDate = previousDate(date);
        if (!playerId || !numericTeamId || !/^\d{4}-\d{2}-\d{2}$/.test(debutDate)) {
            return null;
        }
        const params = new URLSearchParams({
            stats: "byDateRange",
            group,
            gameType: "R",
            sportIds: "1",
            startDate: debutDate,
            endDate
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/stats?${params}`,
            `pregame:franchise-stats:${playerId}:${numericTeamId}:${group}:${endDate}`
        ).catch(() => null);
        const splits = (payload?.stats ?? []).flatMap((entry) => entry?.splits ?? [])
            .filter((split) => Number(split?.team?.id) === numericTeamId);
        if (!splits.length) return null;
        return splits.reduce((totals, split) => {
            Object.values(FRANCHISE_RECORD_FIELDS).forEach((field) => {
                totals[field] = (totals[field] ?? 0) + statNumber(split?.stat?.[field]);
            });
            return totals;
        }, {});
    };

    const getOfficialTeamScheduleUrl = (team, gameDate) => {
        const slug = window.MLB_SCOREBOOK_TEAM_SLUGS_BY_ID?.[Number(team?.id)];
        const month = /^\d{4}-\d{2}-\d{2}$/.test(String(gameDate))
            ? String(gameDate).slice(0, 7)
            : "";
        return slug && month ? `https://www.mlb.com/${slug}/schedule/${month}` : "";
    };

    const getBaseballReferenceBattingUrl = (person) => {
        const referenceId = person?.xrefIds?.find(
            (xref) => String(xref?.xrefType ?? "").toLowerCase() === "lahman"
        )?.xrefId;
        if (!referenceId) return "";
        return `https://www.baseball-reference.com/players/${String(referenceId).charAt(0)}/${referenceId}.shtml`;
    };

    const getBaseballReferencePitchingGameLogUrl = (person, season) => {
        const referenceId = person?.xrefIds?.find(
            (xref) => String(xref?.xrefType ?? "").toLowerCase() === "lahman"
        )?.xrefId;
        if (!referenceId) return "";
        const url = new URL("https://www.baseball-reference.com/players/gl.fcgi");
        url.searchParams.set("id", referenceId);
        url.searchParams.set("t", "p");
        url.searchParams.set("year", String(season));
        return url.toString();
    };

    const formatAverage = (value) => {
        const numeric = Number.parseFloat(value);
        return Number.isFinite(numeric) ? numeric.toFixed(3).replace(/^0/, "") : "-";
    };

    const battingStatLink = (text, href, ariaLabel) => {
        const node = el(href ? "a" : "span", "pregame-batting-stat", text);
        if (href) {
            node.href = href;
            node.target = "_blank";
            node.rel = "noopener noreferrer";
            node.setAttribute("aria-label", ariaLabel);
        }
        return node;
    };

    const BATTING_TABLE_COLUMNS = [
        { label: "試合", field: "gamesPlayed" },
        { label: "打数", field: "atBats" },
        { label: "安打", field: "hits" },
        { label: "打率", field: "avg", rate: true },
        { label: "本塁打", field: "homeRuns" },
        { label: "打点", field: "rbi" },
        { label: "盗塁", field: "stolenBases" },
        { label: "得点圏", field: "risp", rate: true },
        { label: "長打率", field: "slg", rate: true },
        { label: "二塁打", field: "doubles" },
        { label: "三塁打", field: "triples" },
        { label: "四球", field: "baseOnBalls" },
        { label: "死球", field: "hitByPitch" },
        { label: "三振", field: "strikeOuts" },
        { label: "犠打", field: "sacBunts" },
        { label: "犠飛", field: "sacFlies" },
        { label: "失策", field: "errors" }
    ];

    const battingTableValue = (row, column) => {
        if (column.field === "risp") {
            if (!row.risp) return "-";
            return formatAverage(row.risp.atBats ? row.risp.hits / row.risp.atBats : 0);
        }
        if (column.field === "errors") {
            return row.errors == null ? "-" : String(row.errors);
        }
        const value = row.stats?.[column.field];
        if (value == null || value === "") return "-";
        return column.rate ? formatAverage(value) : String(value);
    };

    const renderBattingStatsTable = (
        title,
        rows,
        referenceUrl,
        player,
        { includeSeason = false } = {}
    ) => {
        const card = el("section", "pregame-batting-summary-card pregame-batting-table-card");
        card.append(el("h3", "pregame-batting-summary-title", title));
        const scroller = el("div", "pregame-batting-table-scroll");
        const table = el("table", "pregame-batting-table");
        const colgroup = document.createElement("colgroup");
        if (includeSeason) colgroup.append(el("col", "pregame-batting-year-col"));
        BATTING_TABLE_COLUMNS.forEach((column) => {
            colgroup.append(el("col", `pregame-batting-col-${column.field}`));
        });
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        if (includeSeason) headRow.append(el("th", "pregame-batting-year", "年度"));
        BATTING_TABLE_COLUMNS.forEach((column) => headRow.append(el("th", "", column.label)));
        head.append(headRow);
        const body = document.createElement("tbody");
        rows.forEach((row) => {
            const tr = document.createElement("tr");
            if (includeSeason) tr.append(el("th", "pregame-batting-year", row.label));
            BATTING_TABLE_COLUMNS.forEach((column) => {
                const td = document.createElement("td");
                const value = battingTableValue(row, column);
                const linked = battingStatLink(
                    value,
                    value === "-" ? "" : referenceUrl,
                    `${playerName(player)}の${row.label ? `${row.label}年 ` : ""}${column.label}をBaseball-Referenceで開く`
                );
                linked.classList.add("pregame-batting-table-link");
                td.append(linked);
                tr.append(td);
            });
            body.append(tr);
        });
        table.append(colgroup, head, body);
        scroller.append(table);
        card.append(scroller);
        return card;
    };

    const PITCHING_TABLE_COLUMNS = [
        { label: "登板", field: "gamesPlayed" },
        { label: "先発", field: "gamesStarted" },
        { label: "投球回", field: "inningsPitched" },
        { label: "勝", field: "wins" },
        { label: "敗", field: "losses" },
        { label: "防御率", field: "era", rate: true },
        { label: "完投", field: "completeGames" },
        { label: "完封", field: "shutouts" },
        { label: "セーブ", field: "saves" },
        { label: "失点", field: "runs" },
        { label: "自責点", field: "earnedRuns" },
        { label: "被本塁打", field: "homeRuns" },
        { label: "与四球", field: "baseOnBalls" },
        { label: "与死球", field: "hitBatsmen" },
        { label: "奪三振", field: "strikeOuts" },
        { label: "WHIP", field: "whip", rate: true }
    ];

    const pitchingTableValue = (row, column) => {
        const value = row.stats?.[column.field];
        if (value == null || value === "") return "-";
        if (column.rate) {
            const numeric = Number.parseFloat(value);
            return Number.isFinite(numeric) ? numeric.toFixed(2) : "-";
        }
        return String(value);
    };

    const renderPitchingStatsTable = (
        title,
        rows,
        referenceUrl,
        player,
        { includeSeason = false } = {}
    ) => {
        const card = el(
            "section",
            "pregame-batting-summary-card pregame-batting-table-card pregame-pitching-table-card"
        );
        card.append(el("h3", "pregame-batting-summary-title", title));
        const scroller = el("div", "pregame-batting-table-scroll");
        const table = el("table", "pregame-batting-table pregame-pitching-table");
        const colgroup = document.createElement("colgroup");
        if (includeSeason) colgroup.append(el("col", "pregame-batting-year-col"));
        PITCHING_TABLE_COLUMNS.forEach((column) => {
            colgroup.append(el("col", `pregame-pitching-col-${column.field}`));
        });
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        if (includeSeason) headRow.append(el("th", "pregame-batting-year", "年度"));
        PITCHING_TABLE_COLUMNS.forEach((column) => headRow.append(el("th", "", column.label)));
        head.append(headRow);
        const body = document.createElement("tbody");
        rows.forEach((row) => {
            const tr = document.createElement("tr");
            if (includeSeason) tr.append(el("th", "pregame-batting-year", row.label));
            PITCHING_TABLE_COLUMNS.forEach((column) => {
                const td = document.createElement("td");
                const value = pitchingTableValue(row, column);
                const linked = battingStatLink(
                    value,
                    value === "-" ? "" : referenceUrl,
                    `${playerName(player)}の${row.label ? `${row.label}年 ` : ""}${column.label}をBaseball-Referenceで開く`
                );
                linked.classList.add("pregame-batting-table-link");
                td.append(linked);
                tr.append(td);
            });
            body.append(tr);
        });
        table.append(colgroup, head, body);
        scroller.append(table);
        card.append(scroller);
        return card;
    };

    const renderRecentPitchingTable = (splits) => {
        const sectionElement = section("直近5登板");
        sectionElement.classList.add("pregame-span-8", "pregame-recent-pitching-section");
        const scroller = el("div", "pregame-recent-pitching-scroll");
        const table = el("table", "pregame-recent-pitching-table");
        const columns = ["日付", "対戦相手", "防御率", "投球回", "奪三振", "失点", "与四球"];
        const colgroup = document.createElement("colgroup");
        ["date", "opponent", "era", "innings", "strikeouts", "runs", "walks"]
            .forEach((name) => colgroup.append(el("col", `pregame-recent-pitching-col-${name}`)));
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        columns.forEach((label) => headRow.append(el("th", "", label)));
        head.append(headRow);
        const body = document.createElement("tbody");
        [...splits].reverse().forEach((split) => {
            const stat = split?.stat ?? {};
            const outs = inningsToOuts(stat.inningsPitched);
            const dateParts = String(split?.date ?? "").slice(0, 10).split("-");
            const dateLabel = dateParts.length === 3
                ? `${Number(dateParts[1])}/${Number(dateParts[2])}`
                : "-";
            const decision = statNumber(stat.wins) > 0
                ? "（W）"
                : statNumber(stat.losses) > 0
                    ? "（L）"
                    : "";
            const row = document.createElement("tr");
            row.append(el("td", "", dateLabel));
            const opponentCell = el("td", "pregame-recent-pitching-opponent");
            opponentCell.append(el("span", "pregame-recent-pitching-opponent-code", teamCode(split?.opponent)));
            if (decision) {
                opponentCell.append(el("span", "pregame-recent-pitching-decision", decision));
            }
            row.append(opponentCell);
            [
                outs ? (statNumber(stat.earnedRuns) * 27 / outs).toFixed(2) : "－",
                stat?.inningsPitched ?? "－",
                String(statNumber(stat.strikeOuts)),
                String(statNumber(stat.runs)),
                String(statNumber(stat.baseOnBalls))
            ].forEach((value) => row.append(el("td", "", value)));
            body.append(row);
        });
        const totals = aggregatePitching(splits);
        const totalRow = document.createElement("tr");
        totalRow.className = "pregame-recent-pitching-total";
        [
            `直近5登板計（${totals.wins}勝${totals.losses}敗）`,
            "",
            totals.era.toFixed(2),
            totals.innings,
            String(totals.strikeOuts),
            String(totals.runs),
            String(totals.baseOnBalls)
        ].forEach((value, index) => {
            const cell = el(index === 0 ? "th" : "td", "", value);
            if (index === 0) cell.colSpan = 2;
            if (index !== 1) totalRow.append(cell);
        });
        body.append(totalRow);
        table.append(colgroup, head, body);
        scroller.append(table);
        sectionElement.append(scroller);
        return sectionElement;
    };

    const shortLogDate = (split) => {
        const parts = String(split?.date ?? "").slice(0, 10).split("-");
        return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : "-";
    };

    const logMatchupLabel = (split) => `${shortLogDate(split)} vs. ${teamCode(split?.opponent)}`;

    const renderRecentHittingTable = (splits) => {
        const sectionElement = section("直近5試合");
        sectionElement.classList.add("pregame-span-8", "pregame-recent-hitting-section");
        const scroller = el("div", "pregame-recent-hitting-scroll");
        const table = el("table", "pregame-recent-hitting-table");
        const columns = ["日付", "対戦相手", "打数", "安打", "本塁打", "打点", "得点", "盗塁", "四球"];
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        columns.forEach((label) => headRow.append(el("th", "", label)));
        head.append(headRow);
        const body = document.createElement("tbody");
        [...splits].reverse().forEach((split) => {
            const stat = split?.stat ?? {};
            const row = document.createElement("tr");
            [
                shortLogDate(split), teamCode(split?.opponent), String(statNumber(stat.atBats)),
                String(statNumber(stat.hits)), String(statNumber(stat.homeRuns)),
                String(statNumber(stat.rbi)), String(statNumber(stat.runs)),
                String(statNumber(stat.stolenBases)), String(statNumber(stat.baseOnBalls))
            ].forEach((value) => row.append(el("td", "", value)));
            body.append(row);
        });
        const totals = aggregateHitting(splits);
        const totalRow = document.createElement("tr");
        totalRow.className = "pregame-recent-hitting-total";
        [
            "直近5試合TOTAL", "", String(totals.atBats), String(totals.hits),
            String(totals.homeRuns), String(totals.rbi), String(totals.runs),
            String(totals.stolenBases), String(totals.baseOnBalls)
        ].forEach((value, index) => {
            const cell = el(index === 0 ? "th" : "td", "", value);
            if (index === 0) cell.colSpan = 2;
            if (index !== 1) totalRow.append(cell);
        });
        body.append(totalRow);
        table.append(head, body);
        scroller.append(table);
        sectionElement.append(scroller);
        return sectionElement;
    };

    const seasonBestStreakHistory = (splits, qualifies, { ignore = () => false } = {}) => {
        const ordered = [...splits].sort((a, b) => String(a?.date).localeCompare(String(b?.date)));
        let current = [];
        const completed = [];
        ordered.forEach((split) => {
            if (ignore(split)) return;
            if (qualifies(split)) {
                current.push(split);
            } else {
                if (current.length) completed.push({ entries: current, active: false });
                current = [];
            }
        });
        if (current.length) completed.push({ entries: current, active: true });

        let seasonBest = 0;
        return completed.filter((streak) => {
            const count = streak.entries.length;
            if (count < seasonBest) return false;
            seasonBest = Math.max(seasonBest, count);
            return true;
        });
    };

    const seasonRecordFromStreak = (streak, label, minimum = 2) => {
        if (streak.entries.length < minimum) return null;
        const first = streak.entries[0];
        const last = streak.entries.at(-1);
        const range = streak.active
            ? `${logMatchupLabel(first)} ～`
            : `${logMatchupLabel(first)} ～ ${logMatchupLabel(last)}`;
        return {
            text: `${range}　${streak.entries.length}試合連続${label}`,
            active: streak.active,
            sortKey: String(first?.date ?? "")
        };
    };

    const CONSECUTIVE_SEASON_DEFINITIONS = Object.freeze({
        hitting: [
            { field: "homeRuns", minimum: 20, step: 10, unit: "本塁打" },
            { field: "rbi", minimum: 90, step: 10, unit: "打点" },
            { field: "hits", minimum: 150, step: 10, unit: "安打" },
            { field: "stolenBases", minimum: 20, step: 10, unit: "盗塁" }
        ],
        pitching: [
            { field: "strikeOuts", minimum: 100, step: 50, unit: "奪三振" },
            { field: "wins", minimum: 10, step: 10, unit: "勝" },
            { field: "saves", minimum: 20, step: 10, unit: "セーブ" },
            { field: "gamesPlayed", minimum: 50, step: 10, unit: "登板" }
        ]
    });

    const consecutiveSeasonRecords = (yearlyStats, season, group) =>
        CONSECUTIVE_SEASON_DEFINITIONS[group].flatMap((definition) => {
            const current = statNumber(yearlyStats?.get(season)?.[definition.field]);
            if (current < definition.minimum) return [];
            const maximumLevel = definition.minimum + Math.floor(
                Math.max(0, current - definition.minimum) / definition.step
            ) * definition.step;
            for (let level = maximumLevel;
                level >= definition.minimum;
                level -= definition.step) {
                let firstSeason = season;
                while (statNumber(
                    yearlyStats?.get(firstSeason - 1)?.[definition.field]
                ) >= level) firstSeason -= 1;
                const count = season - firstSeason + 1;
                if (count >= 2) return [{
                    text: `${count}年連続${level}${definition.unit}以上` +
                        `（${firstSeason}〜${season}）`,
                    active: true,
                    sortKey: `${season}-12-31`
                }];
            }
            return [];
        });

    const getSeasonRecords = (logs, {
        priorCareerCompleteGames = 0,
        yearlyBatting = new Map(),
        yearlyPitching = new Map(),
        season = 0
    } = {}) => {
        const records = [];
        records.push(
            ...consecutiveSeasonRecords(yearlyBatting, season, "hitting"),
            ...consecutiveSeasonRecords(yearlyPitching, season, "pitching")
        );
        if (logs.hitting?.length) {
            const played = (split) => {
                const stat = split?.stat ?? {};
                return statNumber(stat.plateAppearances) || statNumber(stat.atBats) +
                    statNumber(stat.baseOnBalls) + statNumber(stat.hitByPitch);
            };
            [
                ["安打", (split) => statNumber(split?.stat?.hits) > 0],
                ["出塁", (split) => statNumber(split?.stat?.hits) + statNumber(split?.stat?.baseOnBalls) + statNumber(split?.stat?.hitByPitch) > 0],
                ["打点", (split) => statNumber(split?.stat?.rbi) > 0]
            ].forEach(([label, qualifies]) => {
                seasonBestStreakHistory(
                    logs.hitting,
                    qualifies,
                    { ignore: (split) => !played(split) }
                ).forEach((streak) => {
                    const record = seasonRecordFromStreak(streak, label);
                    if (record) records.push(record);
                });
            });
            const firstHomeRun = [...logs.hitting]
                .sort((a, b) => String(a?.date).localeCompare(String(b?.date)))
                .find((split) => statNumber(split?.stat?.homeRuns) > 0);
            if (firstHomeRun) records.push({
                text: `${logMatchupLabel(firstHomeRun)}　今季初本塁打`,
                active: false,
                sortKey: String(firstHomeRun?.date ?? "")
            });
        }
        if (logs.pitching?.length) {
            const starts = logs.pitching.filter((split) => statNumber(split?.stat?.gamesStarted) > 0);
            const qualityStarts = seasonBestStreakHistory(
                starts,
                (split) => inningsToOuts(split?.stat?.inningsPitched) >= 18 && statNumber(split?.stat?.earnedRuns) <= 3
            );
            qualityStarts.forEach((streak) => {
                const qsRecord = seasonRecordFromStreak(streak, "QS");
                if (qsRecord) records.push(qsRecord);
            });
            const decisions = logs.pitching.filter((split) =>
                statNumber(split?.stat?.wins) > 0 || statNumber(split?.stat?.losses) > 0
            );
            seasonBestStreakHistory(
                decisions,
                (split) => statNumber(split?.stat?.wins) > 0
            ).forEach((streak) => {
                const winStreak = seasonRecordFromStreak(streak, "勝");
                if (!winStreak) return;
                winStreak.text = winStreak.text.replace(/(\d+)試合連続勝$/, "$1連勝");
                records.push(winStreak);
            });
            let completeGamesSeen = statNumber(priorCareerCompleteGames);
            [...logs.pitching]
                .sort((a, b) => String(a?.date).localeCompare(String(b?.date)))
                .forEach((split) => {
                const stat = split?.stat ?? {};
                if (inningsToOuts(stat.inningsPitched) >= 27 && statNumber(stat.hits) === 0) {
                    records.push({
                        text: `${logMatchupLabel(split)}　ノーヒットノーラン`,
                        active: false,
                        sortKey: String(split?.date ?? "")
                    });
                } else if (statNumber(stat.completeGames) > 0) {
                    const label = completeGamesSeen === 0 ? "キャリア初完投" : "完投";
                    records.push({
                        text: `${logMatchupLabel(split)}　${label}`,
                        active: false,
                        sortKey: String(split?.date ?? "")
                    });
                }
                completeGamesSeen += statNumber(stat.completeGames);
            });
        }
        return records.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
    };

    const renderSeasonRecordList = (records) => {
        const list = el("ul", "pregame-data-list pregame-season-record-list");
        if (!records.length) {
            list.append(el("li", "", "今シーズンに表示対象となる記録はありません。"));
            return list;
        }
        records.forEach((record) => {
            const row = el("li", "pregame-season-record-row");
            row.append(el("span", "pregame-season-record-text", record.text));
            if (record.active) row.append(el("span", "pregame-status-badge pregame-season-record-status", "継続中"));
            list.append(row);
        });
        return list;
    };

    const statcastAverageLabel = (value) => {
        if (!Number.isFinite(value)) return "—";
        return value.toFixed(3).replace(/^0/, "");
    };

    const renderStatcastSection = (history, zones, person, season) => {
        const wrapper = section("Statcast", "Baseball Savant");
        wrapper.classList.add("pregame-statcast-section");
        wrapper.querySelector("h3")?.append(el("small", "pregame-statcast-season-note", "（レギュラーシーズン）"));
        const metrics = el("div", "pregame-statcast-metrics");
        const sourceUrl = savantPlayerUrl(person);
        [
            ["バレル率", "brl_percent", "%"],
            ["平均打球速度", "avg_hit_speed", " mph"],
            ["Hard-Hit率", "ev95percent", "%"],
            ["最長飛距離", "max_distance", " ft"]
        ].forEach(([label, key, unit]) => {
            const card = el("div", "pregame-statcast-metric");
            card.classList.add(`pregame-statcast-${key}`);
            card.append(el("span", "pregame-statcast-label", label));
            const rows = el("div", "pregame-statcast-history");
            history.forEach(({ season: rowSeason, stats }) => {
                const value = stats?.[key];
                let displayValue = value == null || value === "" ? "—" : `${value}${unit}`;
                const numericValue = Number(value);
                if (Number.isFinite(numericValue) && key === "avg_hit_speed") {
                    displayValue = `${value} mph（${(numericValue * 1.609344).toFixed(1)}km）`;
                } else if (Number.isFinite(numericValue) && key === "max_distance") {
                    displayValue = `${value} ft（${(numericValue * 0.3048).toFixed(1)}m）`;
                }
                const row = el("div", "pregame-statcast-history-row");
                row.append(el("span", "pregame-statcast-season", String(rowSeason)));
                const hasSource = value != null && value !== "" && sourceUrl;
                const valueNode = el(hasSource ? "a" : "strong", "pregame-statcast-value", displayValue);
                if (hasSource) {
                    valueNode.href = sourceUrl;
                    valueNode.target = "_blank";
                    valueNode.rel = "noopener noreferrer";
                    valueNode.setAttribute("aria-label", `${rowSeason}年 ${label} ${displayValue}（Baseball Savant公式）`);
                }
                row.append(valueNode);
                rows.append(row);
            });
            if (!history.length) rows.append(el("strong", "pregame-statcast-value", "—"));
            card.append(rows);
            metrics.append(card);
        });

        const zoneCard = el("div", "pregame-statcast-metric pregame-statcast-zone-card");
        zoneCard.append(el("span", "pregame-statcast-label", "コース別打率"));
        const zoneLink = savantPlayerUrl(person, "zones");
        const zoneChart = el("div", "pregame-zone-chart");
        const outer = el("div", "pregame-zone-outer");
        [11, 12, 13, 14].forEach((zone) => {
            const value = zones?.get(zone);
            const node = el(zoneLink && Number.isFinite(value) ? "a" : "span", `pregame-zone-cell pregame-zone-${zone}`, statcastAverageLabel(value));
            node.style.setProperty("--pregame-zone-strength", Number.isFinite(value) ? String(Math.min(1, value / 0.5)) : "0");
            if (node.tagName === "A") {
                node.href = zoneLink;
                node.target = "_blank";
                node.rel = "noopener noreferrer";
                node.setAttribute("aria-label", `${season}年 ゾーン${zone} 打率${statcastAverageLabel(value)}（Baseball Savant公式）`);
            }
            outer.append(node);
        });
        const inner = el("div", "pregame-zone-inner");
        for (let zone = 1; zone <= 9; zone += 1) {
            const value = zones?.get(zone);
            const node = el(zoneLink && Number.isFinite(value) ? "a" : "span", "pregame-zone-cell", statcastAverageLabel(value));
            node.style.setProperty("--pregame-zone-strength", Number.isFinite(value) ? String(Math.min(1, value / 0.5)) : "0");
            if (node.tagName === "A") {
                node.href = zoneLink;
                node.target = "_blank";
                node.rel = "noopener noreferrer";
                node.setAttribute("aria-label", `${season}年 ゾーン${zone} 打率${statcastAverageLabel(value)}（Baseball Savant公式）`);
            }
            inner.append(node);
        }
        zoneChart.append(outer, inner);
        const zoneVisual = el("div", "pregame-zone-visual");
        zoneVisual.append(zoneChart, el("span", "pregame-zone-home-plate"));
        zoneCard.append(el("span", "pregame-zone-view-label", `${season}年・打者視点`), zoneVisual);
        metrics.append(zoneCard);
        wrapper.append(metrics);
        return wrapper;
    };

    const renderPitcherStatcastSection = (seasonRows, person, season) => {
        const wrapper = section("Statcast", "Baseball Savant");
        wrapper.classList.add("pregame-statcast-section", "pregame-pitcher-statcast-section");
        wrapper.querySelector("h3")?.append(el("small", "pregame-statcast-season-note", "（レギュラーシーズン）"));

        const currentRows = seasonRows.find((entry) => entry.season === season)?.rows ?? [];
        const currentPitchCounts = new Map();
        currentRows.forEach((row) => {
            const pitchType = String(row.pitch_type ?? "").trim();
            if (pitchType) currentPitchCounts.set(pitchType, (currentPitchCounts.get(pitchType) ?? 0) + 1);
        });
        const allPitchTypes = new Set();
        seasonRows.forEach(({ rows }) => rows.forEach((row) => {
            const pitchType = String(row.pitch_type ?? "").trim();
            if (pitchType) allPitchTypes.add(pitchType);
        }));
        const pitchTypes = [...allPitchTypes].sort((a, b) =>
            (currentPitchCounts.get(b) ?? 0) - (currentPitchCounts.get(a) ?? 0) ||
            pitcherPitchTypeLabel(a, currentRows).localeCompare(pitcherPitchTypeLabel(b, currentRows), "ja")
        );
        let selectedPitchType = [...currentPitchCounts.entries()]
            .sort((a, b) => b[1] - a[1])[0]?.[0] ?? pitchTypes[0] ?? "";
        let selectedBatterSide = "";

        const filters = el("div", "pregame-statcast-filters");
        const pitchLabel = el("label", "pregame-statcast-filter");
        pitchLabel.append(el("span", "", "球種"));
        const pitchSelect = el("select", "pregame-statcast-select");
        const allPitchesOption = el("option", "", "全球種");
        allPitchesOption.value = "";
        pitchSelect.append(allPitchesOption);
        pitchTypes.forEach((pitchType) => {
            const option = el("option", "", pitcherPitchTypeLabel(pitchType, currentRows));
            option.value = pitchType;
            pitchSelect.append(option);
        });
        pitchSelect.value = selectedPitchType;
        pitchLabel.append(pitchSelect);

        const sideLabel = el("label", "pregame-statcast-filter");
        sideLabel.append(el("span", "", "対打者"));
        const sideSelect = el("select", "pregame-statcast-select");
        [["", "全打者"], ["R", "右打者"], ["L", "左打者"]].forEach(([value, label]) => {
            const option = el("option", "", label);
            option.value = value;
            sideSelect.append(option);
        });
        sideLabel.append(sideSelect);
        filters.append(pitchLabel, sideLabel);
        wrapper.append(filters);

        const metrics = el("div", "pregame-statcast-metrics");
        const sourceUrl = savantPitcherUrl(person);
        const metricDefinitions = [
            ["平均球速", "averageVelocity"],
            ["Whiff%", "whiffPercent"],
            ["Chase%", "chasePercent"],
            ["Hard-Hit%", "hardHitPercent"]
        ];
        const metricHistories = new Map();
        metricDefinitions.forEach(([label, key]) => {
            const card = el("div", `pregame-statcast-metric pregame-pitcher-statcast-${key}`);
            card.append(el("span", "pregame-statcast-label", label));
            const history = el("div", "pregame-statcast-history");
            metricHistories.set(key, { history, label });
            card.append(history);
            metrics.append(card);
        });

        const zoneCard = el("div", "pregame-statcast-metric pregame-statcast-zone-card");
        zoneCard.append(el("span", "pregame-statcast-label", "コース別被打率"));
        const zoneViewLabel = el("span", "pregame-zone-view-label");
        const zoneLink = savantPitcherUrl(person, "zones");
        const zoneChart = el("div", "pregame-zone-chart");
        const outer = el("div", "pregame-zone-outer");
        const zoneNodes = new Map();
        [11, 12, 13, 14].forEach((zone) => {
            const node = el("span", `pregame-zone-cell pregame-zone-${zone}`, "—");
            zoneNodes.set(zone, node);
            outer.append(node);
        });
        const inner = el("div", "pregame-zone-inner");
        for (let zone = 1; zone <= 9; zone += 1) {
            const node = el("span", "pregame-zone-cell", "—");
            zoneNodes.set(zone, node);
            inner.append(node);
        }
        zoneChart.append(outer, inner);
        const zoneVisual = el("div", "pregame-zone-visual");
        zoneVisual.append(zoneChart, el("span", "pregame-zone-home-plate"));
        zoneCard.append(zoneViewLabel, zoneVisual);
        metrics.append(zoneCard);
        wrapper.append(metrics);

        const formatMetric = (key, value) => {
            if (!Number.isFinite(value)) return "—";
            if (key === "averageVelocity") {
                return `${value.toFixed(1)} mph（${(value * 1.609344).toFixed(1)} km/h）`;
            }
            return `${value.toFixed(1)}%`;
        };
        const update = () => {
            selectedPitchType = pitchSelect.value;
            selectedBatterSide = sideSelect.value;
            const aggregates = new Map(seasonRows.map(({ season: rowSeason, rows }) => [
                rowSeason,
                aggregatePitcherStatcast(rows, selectedPitchType, selectedBatterSide)
            ]));
            metricHistories.forEach(({ history, label }, key) => {
                history.replaceChildren();
                seasonRows.forEach(({ season: rowSeason }) => {
                    const value = aggregates.get(rowSeason)?.[key];
                    const displayValue = formatMetric(key, value);
                    const row = el("div", "pregame-statcast-history-row");
                    row.append(el("span", "pregame-statcast-season", String(rowSeason)));
                    const hasSource = Number.isFinite(value) && sourceUrl;
                    const valueNode = el(hasSource ? "a" : "strong", "pregame-statcast-value", displayValue);
                    if (hasSource) {
                        valueNode.href = sourceUrl;
                        valueNode.target = "_blank";
                        valueNode.rel = "noopener noreferrer";
                        valueNode.setAttribute("aria-label", `${rowSeason}年 ${label} ${displayValue}（Baseball Savant公式）`);
                    }
                    row.append(valueNode);
                    history.append(row);
                });
                if (!seasonRows.length) history.append(el("strong", "pregame-statcast-value", "—"));
            });

            const currentAggregate = aggregates.get(season);
            const pitchText = selectedPitchType
                ? pitcherPitchTypeLabel(selectedPitchType, currentRows)
                : "全球種";
            const sideText = selectedBatterSide === "R" ? "右打者" : selectedBatterSide === "L" ? "左打者" : "全打者";
            zoneViewLabel.textContent = `${season}年・${pitchText}・対${sideText}・打者視点`;
            zoneNodes.forEach((node, zone) => {
                const value = currentAggregate?.zones?.get(zone);
                node.textContent = statcastAverageLabel(value);
                node.style.setProperty("--pregame-zone-strength", Number.isFinite(value) ? String(Math.min(1, value / 0.5)) : "0");
                if (zoneLink && Number.isFinite(value)) {
                    node.setAttribute("role", "link");
                    node.tabIndex = 0;
                    node.setAttribute("aria-label", `${season}年 ゾーン${zone} 被打率${statcastAverageLabel(value)}（Baseball Savant公式）`);
                    node.onclick = () => window.open(zoneLink, "_blank", "noopener,noreferrer");
                    node.onkeydown = (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            window.open(zoneLink, "_blank", "noopener,noreferrer");
                        }
                    };
                } else {
                    node.removeAttribute("role");
                    node.removeAttribute("tabindex");
                    node.removeAttribute("aria-label");
                    node.onclick = null;
                    node.onkeydown = null;
                }
            });
        };
        pitchSelect.addEventListener("change", update);
        sideSelect.addEventListener("change", update);
        update();
        return wrapper;
    };

    const AWARD_CATEGORIES = Object.freeze([
        { key: "mvp", label: "最優秀選手（MVP）", ids: ["ALMVP", "NLMVP"] },
        { key: "cy-young", label: "サイ・ヤング賞", ids: ["MLBCY", "ALCY", "NLCY"] },
        { key: "rookie", label: "新人王", ids: ["MLBROY", "ALROY", "NLROY"] },
        { key: "world-series-mvp", label: "ワールドシリーズMVP", ids: ["WSMVP"] },
        { key: "lcs-mvp", label: "リーグ優勝決定シリーズMVP", ids: ["ALCSMVP", "NLCSMVP"] },
        { key: "hank-aaron", label: "ハンク・アーロン賞", ids: ["ALHAA", "NLHAA"] },
        { key: "silver-slugger", label: "シルバースラッガー賞", ids: ["ALSS", "NLSS"] },
        { key: "gold-glove", label: "ゴールドグラブ賞", ids: ["ALGG", "NLGG"] },
        { key: "platinum-glove", label: "プラチナ・グラブ賞", ids: ["ALPG", "NLPG"] },
        { key: "outstanding-dh", label: "エドガー・マルティネス賞", ids: ["DHOY"] },
        { key: "reliever", label: "リリーバー・オブ・ザ・イヤー", ids: ["ALREL", "NLREL"] },
        { key: "comeback", label: "カムバック賞", ids: ["ALCPOY", "NLCPOY"] },
        { key: "all-star-mvp", label: "オールスターゲームMVP", ids: ["ASMVP"] },
        { key: "all-star", label: "オールスター選出", ids: ["ALAS", "NLAS"] },
        { key: "all-mlb-first", label: "オールMLB・ファーストチーム", ids: ["MLBAFIRST"] },
        { key: "all-mlb-second", label: "オールMLB・セカンドチーム", ids: ["MLBSECOND"] },
        { key: "commissioner", label: "コミッショナー特別表彰", ids: ["MLBCOMHA"] }
    ]);

    const AWARD_CATEGORY_BY_ID = new Map(
        AWARD_CATEGORIES.flatMap((category) =>
            category.ids.map((id) => [id, category])
        )
    );

    const getPlayerAwards = async (playerId) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}/awards`,
            `player-awards:${playerId}`
        );
        return payload?.awards ?? [];
    };

    const getAwardLeague = (awardId) => {
        if (String(awardId).startsWith("AL")) return "AL";
        if (String(awardId).startsWith("NL")) return "NL";
        return "";
    };

    const normalizePlayerAwards = (awards) => {
        const grouped = new Map(AWARD_CATEGORIES.map((category) => [category.key, []]));
        const seen = new Set();
        awards.forEach((award) => {
            const category = AWARD_CATEGORY_BY_ID.get(String(award?.id ?? ""));
            const season = Number(award?.season);
            if (!category || !Number.isInteger(season)) return;
            const league = getAwardLeague(award.id);
            const dedupeKey = `${category.key}:${season}:${league}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            grouped.get(category.key).push({ season, league });
        });
        return AWARD_CATEGORIES.map((category) => ({
            ...category,
            years: grouped.get(category.key)
                .sort((left, right) => left.season - right.season || left.league.localeCompare(right.league))
        })).filter((category) => category.years.length);
    };

    const renderAwardsSection = (awards) => {
        const categories = normalizePlayerAwards(awards);
        if (!categories.length) return null;
        const wrapper = section("AWARDS");
        wrapper.classList.add("pregame-awards-section");
        const table = el("table", "pregame-awards-table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        headRow.append(el("th", "", "受賞歴"), el("th", "", "受賞年度"));
        head.append(headRow);
        const body = document.createElement("tbody");
        categories.forEach((category) => {
            const row = document.createElement("tr");
            row.append(el("th", "", category.label));
            const yearsCell = document.createElement("td");
            const years = el("div", "pregame-awards-years");
            category.years.forEach(({ season, league }) => {
                years.append(el("span", "pregame-awards-year", `${season}${league ? `（${league}）` : ""}`));
            });
            yearsCell.append(years);
            row.append(yearsCell);
            body.append(row);
        });
        table.append(head, body);
        wrapper.append(table);
        return wrapper;
    };

    const renderPlayerDetail = async (playerId, gamePk, teamId = null) => {
        scrollPregameToTop();
        const validGamePk = Number.isFinite(Number(gamePk)) && Number(gamePk) > 0;
        placeHeaderActions(false);
        savePregameSession("pregame-player", {
            playerId: Number(playerId),
            ...(validGamePk ? { gamePk: Number(gamePk) } : {}),
            ...(Number(teamId) ? { team: Number(teamId) } : {})
        });
        dom.view.classList.add("pregame-player-detail-active");
        setLoading(true);
        try {
            const game = validGamePk
                ? gameIndex.get(Number(gamePk)) ?? currentContext?.scheduleGame ?? {}
                : {};
            const date = String(game?.officialDate ?? currentDate);
            const season = Number(date.slice(0, 4));
            const [feed, articles, teamPayload] = await Promise.all([
                validGamePk ? getFeed(gamePk) : Promise.resolve(null),
                validGamePk ? getGameArticles(gamePk) : Promise.resolve([]),
                !validGamePk && Number(teamId)
                    ? fetchJson(`${API_ROOT}/v1/teams/${Number(teamId)}`, `pregame:team-details:${Number(teamId)}`)
                        .catch(() => null)
                    : Promise.resolve(null)
            ]);
            const person = getPlayerFromFeed(feed, playerId) ??
                (await fetchJson(`${API_ROOT}/v1/people/${playerId}`, `pregame:person:${playerId}`))?.people?.[0];
            const primaryType = String(person?.primaryPosition?.type ?? "").toLowerCase();
            const isPitcher = primaryType === "pitcher";
            const isTwoWay = primaryType.includes("two-way") || person?.primaryPosition?.abbreviation === "TWP";
            const groups = isTwoWay ? ["hitting", "pitching"] : [isPitcher ? "pitching" : "hitting"];
            const logs = Object.fromEntries(await Promise.all(groups.map(async (group) => [
                group,
                (await getPlayerGameLog(playerId, season, group))
                    .filter((split) => String(split?.date ?? "") < date)
            ])));
            const battingProfilePayload = await fetchJson(
                `${API_ROOT}/v1/people/${playerId}?hydrate=xrefId`,
                `pregame:player-profile-xref:${playerId}`
            ).catch(() => null);
            const battingProfile = battingProfilePayload?.people?.[0] ?? person;
            const isJapanesePlayer = globalThis.MLBJapanesePlayers?.isJapanesePlayer(battingProfile) ??
                String(battingProfile?.birthCountry ?? person?.birthCountry ?? "").toLowerCase() === "japan";
            const debutDate = /^\d{4}-\d{2}-\d{2}$/.test(String(battingProfile?.mlbDebutDate ?? ""))
                ? battingProfile.mlbDebutDate
                : `${season}-01-01`;
            const hasHitting = groups.includes("hitting");
            const hasPitching = groups.includes("pitching");
            const [
                seasonBatting,
                careerBatting,
                yearlyBatting,
                yearlyErrors,
                currentSeasonErrors,
                rispBySeason,
                seasonPitching,
                careerPitching,
                yearlyPitching,
                playerAwards
            ] = await Promise.all([
                hasHitting
                    ? getPlayerSeasonStatsBeforeDate(playerId, season, "hitting", date).catch(() => ({}))
                    : {},
                hasHitting
                    ? getPlayerCareer(battingProfile, "hitting", previousDate(date)).catch(() => ({}))
                    : {},
                hasHitting ? getPlayerYearByYearBatting(playerId).catch(() => new Map()) : new Map(),
                hasHitting ? getPlayerYearByYearErrors(playerId) : new Map(),
                hasHitting ? getPlayerFieldingErrorsBeforeDate(playerId, season, date) : null,
                hasHitting ? getPlayerRispStatsBySeason(playerId, date, debutDate) : new Map(),
                hasPitching
                    ? getPlayerSeasonStatsBeforeDate(playerId, season, "pitching", date).catch(() => ({}))
                    : {},
                hasPitching
                    ? getPlayerCareer(battingProfile, "pitching", previousDate(date)).catch(() => ({}))
                    : {},
                hasPitching ? getPlayerYearByYearPitching(playerId).catch(() => new Map()) : new Map(),
                isJapanesePlayer ? getPlayerAwards(playerId).catch(() => []) : []
            ]);
            const statcastSeasonCandidates = [...yearlyBatting.keys()];
            if (statNumber(seasonBatting?.gamesPlayed) > 0 && !statcastSeasonCandidates.includes(season)) {
                statcastSeasonCandidates.push(season);
            }
            const statcastSeasons = hasHitting
                ? [...new Set(statcastSeasonCandidates)]
                    .map(Number)
                    .filter((year) => Number.isInteger(year) && year <= season)
                    .sort((a, b) => b - a)
                    .slice(0, 5)
                : [];
            const [statcastHistory, statcastZones] = hasHitting
                ? await Promise.all([
                    Promise.all(statcastSeasons.map(async (year) => ({
                        season: year,
                        stats: await getSavantHittingMetrics(
                            playerId,
                            year,
                            year === season ? date : ""
                        ).catch(() => null)
                    }))).then((rows) => rows.filter((row) => row.stats)),
                    getSavantZoneBattingAverage(playerId, season, date).catch(() => new Map())
                ])
                : [[], new Map()];
            const statcastPitchingSeasonCandidates = [...yearlyPitching.keys()];
            if (statNumber(seasonPitching?.gamesPlayed) > 0 && !statcastPitchingSeasonCandidates.includes(season)) {
                statcastPitchingSeasonCandidates.push(season);
            }
            const statcastPitchingSeasons = hasPitching
                ? [...new Set(statcastPitchingSeasonCandidates)]
                    .map(Number)
                    .filter((year) => Number.isInteger(year) && year <= season)
                    .sort((a, b) => b - a)
                    .slice(0, 5)
                : [];
            const statcastPitchingRows = hasPitching
                ? await Promise.all(statcastPitchingSeasons.map(async (year) => ({
                    season: year,
                    rows: await getSavantPitchRows(
                        playerId,
                        year,
                        year === season ? date : `${year + 1}-01-01`
                    ).catch(() => [])
                })))
                : [];
            const seasonRisp = rispBySeason.get(season) ?? null;
            const careerRisp = [...rispBySeason.values()].reduce((totals, stats) => ({
                atBats: totals.atBats + statNumber(stats?.atBats),
                hits: totals.hits + statNumber(stats?.hits)
            }), { atBats: 0, hits: 0 });
            const officialArticles = articles.filter((article) => articleHasPlayer(article, playerId));
            const gameInfo = getPlayerGameInfo(feed, game, playerId);

            const playerTeam = [feed?.gameData?.teams?.away, feed?.gameData?.teams?.home]
                .find((team) => Number(team?.id) === Number(person?.currentTeam?.id)) ??
                feed?.gameData?.teams?.[gameInfo?.side] ??
                teamPayload?.teams?.[0] ??
                person?.currentTeam;
            currentPlayerView = {
                playerId: Number(playerId),
                teamId: Number(playerTeam?.id) || Number(teamId) || null
            };
            savePregameSession("pregame-player", {
                playerId: Number(playerId),
                ...(validGamePk ? { gamePk: Number(gamePk) } : {}),
                ...(currentPlayerView.teamId ? { team: currentPlayerView.teamId } : {})
            });
            setPlayerHeader(person, playerTeam, date);
            const battingSummary = el("div", "pregame-batting-summary");
            let yearlyBattingTable = null;
            let yearlyPitchingTable = null;
            const referenceUrl = getBaseballReferenceBattingUrl(battingProfile);
            if (hasHitting) {
                yearlyBatting.set(season, seasonBatting);
                if (currentSeasonErrors == null) yearlyErrors.delete(season);
                else yearlyErrors.set(season, currentSeasonErrors);
                const seasonRows = [{
                    label: "",
                    stats: seasonBatting,
                    risp: seasonRisp,
                    errors: currentSeasonErrors
                }];
                const yearlyRows = [...yearlyBatting.entries()]
                    .filter(([year, stats]) => year <= season && statNumber(stats?.gamesPlayed) > 0)
                    .sort(([yearA], [yearB]) => yearA - yearB)
                    .map(([year, stats]) => ({
                        label: String(year),
                        stats,
                        risp: rispBySeason.get(year) ?? null,
                        errors: yearlyErrors.has(year) ? yearlyErrors.get(year) : null
                    }));
                const pastErrors = [...yearlyErrors.entries()]
                    .filter(([year]) => year < season)
                    .reduce((sum, [_year, errors]) => sum + statNumber(errors), 0);
                const careerErrors = currentSeasonErrors == null
                    ? null
                    : pastErrors + currentSeasonErrors;
                yearlyRows.push({
                    label: "通算",
                    stats: careerBatting,
                    risp: careerRisp.atBats ? careerRisp : null,
                    errors: careerErrors
                });
                battingSummary.append(
                    renderBattingStatsTable(
                        `${season}シーズン成績`,
                        seasonRows,
                        referenceUrl,
                        person
                    )
                );
                yearlyBattingTable = renderBattingStatsTable(
                    "年度別成績",
                    yearlyRows,
                    referenceUrl,
                    person,
                    { includeSeason: true }
                );
            }
            if (hasPitching) {
                yearlyPitching.set(season, seasonPitching);
                const seasonRows = [{ label: "", stats: seasonPitching }];
                const yearlyRows = [...yearlyPitching.entries()]
                    .filter(([year, stats]) => year <= season && statNumber(stats?.gamesPlayed) > 0)
                    .sort(([yearA], [yearB]) => yearA - yearB)
                    .map(([year, stats]) => ({ label: String(year), stats }));
                yearlyRows.push({ label: "通算", stats: careerPitching });
                battingSummary.append(
                    renderPitchingStatsTable(
                        `${season}シーズン投手成績`,
                        seasonRows,
                        referenceUrl,
                        person
                    )
                );
                yearlyPitchingTable = renderPitchingStatsTable(
                    "年度別投手成績",
                    yearlyRows,
                    referenceUrl,
                    person,
                    { includeSeason: true }
                );
            }
            const grid = el("div", "pregame-detail-grid");
            const recentSections = groups.map((group) => {
                const recent = [...(logs[group] ?? [])].slice(-10);
                const five = recent.slice(-5);
                if (group === "pitching") {
                    return renderRecentPitchingTable(five);
                }
                return renderRecentHittingTable(five);
            });

            const currentSection = section("今シーズンの記録");
            currentSection.classList.add("pregame-span-4", "pregame-season-records-section");
            const priorCareerCompleteGames = [...yearlyPitching.entries()]
                .filter(([year]) => Number(year) < season)
                .reduce((total, [_year, stats]) => total + statNumber(stats?.completeGames), 0);
            currentSection.append(renderSeasonRecordList(getSeasonRecords(logs, {
                priorCareerCompleteGames,
                yearlyBatting,
                yearlyPitching,
                season
            })));
            if (isTwoWay && recentSections.length >= 2) {
                grid.append(recentSections[0], currentSection, ...recentSections.slice(1));
            } else {
                grid.append(...recentSections, currentSection);
            }

            const todaySection = section("今日の情報", validGamePk ? statusLabel(game) : "試合なし");
            todaySection.classList.add("pregame-span-6");
            const todayList = el("ul", "pregame-data-list");
            const todayLines = [];
            if (!validGamePk) {
                todayLines.push("本日の試合なし");
            } else if (gameInfo?.battingOrder) {
                todayLines.push(`スタメン：${gameInfo.battingOrder}番 ${positionLabel(gameInfo.position)}`);
            } else if (gameInfo?.appeared) {
                todayLines.push(`途中出場：${positionLabel(gameInfo.position)}`);
            } else {
                todayLines.push("スタメン：未発表またはベンチスタート");
            }
            if (gameInfo?.probable) todayLines.push("先発登板予定");
            if (officialArticles.some((article) => /injur|soreness|tightness|scratched|lineup|rest/i.test(
                [article.headline, article.blurb, article.body].join(" ")
            ))) todayLines.push("欠場・起用に関するMLB公式記事あり");
            todayLines.forEach((text) => todayList.append(el("li", "", text)));
            todaySection.append(todayList);
            grid.append(todaySection);

            const articleSection = section("MLB公式関連記事", "MLB・球団公式");
            articleSection.classList.add("pregame-span-6");
            articleSection.append(renderArticles(officialArticles));
            grid.append(articleSection);

            const playerSections = [battingSummary, grid];
            if (hasHitting) playerSections.push(renderStatcastSection(statcastHistory, statcastZones, battingProfile, season));
            if (hasPitching) playerSections.push(renderPitcherStatcastSection(statcastPitchingRows, battingProfile, season));
            if (yearlyBattingTable) playerSections.push(yearlyBattingTable);
            if (yearlyPitchingTable) playerSections.push(yearlyPitchingTable);
            const awardsSection = renderAwardsSection(playerAwards);
            if (awardsSection) playerSections.push(awardsSection);
            dom.content.replaceChildren(...playerSections);
        } catch (error) {
            console.error(error);
            dom.content.replaceChildren(el("div", "pregame-error", error.message));
        } finally {
            setLoading(false);
        }
    };

    const getTeamSchedule = async (teamId, date) => {
        const season = date.slice(0, 4);
        const endDate = previousDate(date);
        const params = new URLSearchParams({
            sportId: "1",
            teamId: String(teamId),
            startDate: `${season}-02-01`,
            endDate,
            gameType: "R"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/schedule?${params}`,
            `pregame:team-schedule:${teamId}:${endDate}`
        );
        return (payload?.dates ?? []).flatMap((entry) => entry.games ?? [])
            .filter(isFinal);
    };

    const getTeamTrend = async (teamId, date) => {
        const endDate = previousDate(date);
        const schedule = await getTeamSchedule(teamId, date);
        const recent = schedule.slice(-10);
        const results = recent.map((game) => {
            const away = game?.teams?.away ?? {};
            const home = game?.teams?.home ?? {};
            const own = Number(away?.team?.id) === Number(teamId) ? away : home;
            const opponent = own === away ? home : away;
            return {
                outcome: statNumber(own.score) > statNumber(opponent.score) ? "W" : "L",
                opponent: teamCode(opponent?.team),
                date: String(game?.officialDate ?? ""),
                gamePk: Number(game?.gamePk) || null,
                runsFor: statNumber(own.score),
                runsAgainst: statNumber(opponent.score)
            };
        });
        const outcomes = results.map((result) => result.outcome);
        const latest = outcomes.at(-1);
        let streak = 0;
        for (let index = outcomes.length - 1; index >= 0 && outcomes[index] === latest; index -= 1) {
            streak += 1;
        }
        const startDate = recent[0]?.officialDate ?? date;
        const [hittingPayload, pitchingPayload] = await Promise.all([
            fetchJson(
                `${API_ROOT}/v1/teams/${teamId}/stats?stats=byDateRange&group=hitting&gameType=R&startDate=${startDate}&endDate=${endDate}`,
                `pregame:team-hit:${teamId}:${startDate}:${endDate}`
            ).catch(() => null),
            fetchJson(
                `${API_ROOT}/v1/teams/${teamId}/stats?stats=byDateRange&group=pitching&gameType=R&startDate=${startDate}&endDate=${endDate}`,
                `pregame:team-pitch:${teamId}:${startDate}:${endDate}`
            ).catch(() => null)
        ]);
        const hitting = hittingPayload?.stats?.[0]?.splits?.[0]?.stat ?? {};
        const pitching = pitchingPayload?.stats?.[0]?.splits?.[0]?.stat ?? {};
        return {
            wins: outcomes.filter((value) => value === "W").length,
            losses: outcomes.filter((value) => value === "L").length,
            runsFor: results.reduce((total, result) => total + result.runsFor, 0),
            runsAgainst: results.reduce((total, result) => total + result.runsAgainst, 0),
            streakText: streak >= 2 ? `${streak}連${latest === "W" ? "勝" : "敗"}` : "-",
            avg: hitting.avg ?? "-",
            ops: hitting.ops ?? "-",
            era: pitching.era ?? "-",
            results
        };
    };

    const renderTeamTrendHistory = (results) => {
        const history = el("div", "pregame-trend-history");
        const series = [];
        results.forEach((result) => {
            const current = series.at(-1);
            if (current?.opponent === result.opponent) current.results.push(result);
            else series.push({ opponent: result.opponent, results: [result] });
        });
        history.style.setProperty("--trend-game-count", String(Math.max(results.length, 1)));
        series.forEach((group) => {
            const groupElement = el("div", "pregame-trend-series");
            groupElement.style.gridColumn = `span ${group.results.length}`;
            groupElement.style.setProperty("--trend-series-count", String(group.results.length));
            groupElement.append(el("span", "pregame-trend-opponent", group.opponent));
            const outcomes = el("div", "pregame-trend-outcomes");
            outcomes.style.setProperty("--trend-series-count", String(group.results.length));
            group.results.forEach((result) => {
                const mark = el("span", `pregame-trend-result ${result.outcome === "W" ? "is-win" : "is-loss"}`);
                mark.setAttribute("role", "img");
                mark.setAttribute("aria-label", result.outcome === "W" ? "勝利" : "敗戦");
                outcomes.append(mark);
            });
            groupElement.append(outcomes);
            history.append(groupElement);
        });
        return history;
    };

    const renderTeamRunTotals = (runsFor, runsAgainst) => {
        const totals = el("div", "pregame-trend-run-totals");
        [["得点", runsFor], ["失点", runsAgainst]].forEach(([label, value]) => {
            const item = el("div", "pregame-trend-run-total");
            item.append(
                el("span", "pregame-trend-run-label", label),
                el("strong", "pregame-trend-run-value", String(value))
            );
            totals.append(item);
        });
        return totals;
    };

    const getFeaturedPlayers = async (feed, side, date) => {
        const team = feed?.liveData?.boxscore?.teams?.[side] ?? {};
        const teamId = Number(feed?.gameData?.teams?.[side]?.id);
        const boxPlayers = new Map(Object.values(team?.players ?? {}).map((entry) => [
            Number(entry?.person?.id),
            entry
        ]));
        const roster = await getActiveRosterPlayers(teamId, date);
        return roster.map((rosterEntry) => {
            const boxEntry = boxPlayers.get(Number(rosterEntry?.person?.id));
            return {
                ...(boxEntry ?? {}),
                person: { ...(rosterEntry?.person ?? {}), ...(boxEntry?.person ?? {}) },
                position: boxEntry?.position ?? rosterEntry?.position,
                rosterPosition: rosterEntry?.position?.abbreviation,
                teamId
            };
        });
    };

    const FEATURED_AWARD_DEFINITIONS = Object.freeze([
        { id: "ALPOW", label: "週間MVP", league: "AL", period: "week" },
        { id: "NLPOW", label: "週間MVP", league: "NL", period: "week" },
        { id: "ALPOM", label: "月間最優秀選手", league: "AL", period: "month" },
        { id: "NLPOM", label: "月間最優秀選手", league: "NL", period: "month" },
        { id: "ALPITOM", label: "月間最優秀投手", league: "AL", period: "month" },
        { id: "NLPITOM", label: "月間最優秀投手", league: "NL", period: "month" },
        { id: "ALROM", label: "月間最優秀新人", league: "AL", period: "month" },
        { id: "NLROM", label: "月間最優秀新人", league: "NL", period: "month" }
    ]);

    const getPreviousMonthKey = (date) => {
        const value = parseMlbDate(date);
        if (!value) return "";
        value.setUTCMonth(value.getUTCMonth() - 1);
        return value.toISOString().slice(0, 7);
    };

    const findFeaturedAwardArticle = (definition, award, awardDate, targetDate) => {
        const playerId = Number(award?.player?.id);
        const latestAllowedDate = shiftDate(awardDate, definition.period === "week" ? 3 : 7);
        return (window.MLB_LATEST_NEWS ?? [])
            .filter((article) => {
                const publicationDate = String(article?.contentDate ?? "").slice(0, 10);
                if (!publicationDate || publicationDate <= awardDate || publicationDate >= targetDate ||
                    publicationDate > latestAllowedDate) return false;
                const taxonomy = article?.taxonomy ?? [];
                if (definition.period === "week") {
                    return taxonomy.includes("player-of-the-week") &&
                        (article?.playerIds ?? []).some((id) => Number(id) === playerId);
                }
                return taxonomy.includes("player-of-the-month") ||
                    /monthly-awards/i.test(String(article?.slug ?? ""));
            })
            .sort((left, right) =>
                String(left.contentDate).localeCompare(String(right.contentDate))
            )[0] ?? null;
    };

    const getRecentFeaturedAwards = async (date) => {
        const season = Number(date.slice(0, 4));
        const previousMonthKey = getPreviousMonthKey(date);
        const notesByPlayer = new Map();
        const results = await Promise.all(FEATURED_AWARD_DEFINITIONS.map(async (definition) => {
            const payload = await fetchJson(
                `${API_ROOT}/v1/awards/${definition.id}/recipients?season=${season}`,
                `pregame:featured-award:${definition.id}:${season}`
            ).catch(() => null);
            const announced = (payload?.awards ?? []).filter((award) => {
                const awardDate = String(award?.date ?? "").slice(0, 10);
                return awardDate && awardDate < date;
            });
            const latestDate = announced.reduce(
                (latest, award) => String(award?.date ?? "").slice(0, 10) > latest
                    ? String(award.date).slice(0, 10)
                    : latest,
                ""
            );
            if (!latestDate) return [];
            const isCurrentPeriod = definition.period === "week"
                ? latestDate >= shiftDate(date, -7)
                : latestDate.slice(0, 7) === previousMonthKey;
            return isCurrentPeriod
                ? announced
                    .filter((award) => String(award?.date ?? "").slice(0, 10) === latestDate)
                    .map((award) => ({
                        definition,
                        award,
                        awardDate: latestDate,
                        article: findFeaturedAwardArticle(definition, award, latestDate, date)
                    }))
                    .filter((entry) => entry.article)
                : [];
        }));
        results.flat().forEach(({ definition, award, awardDate, article }) => {
            const playerId = Number(award?.player?.id);
            if (!playerId) return;
            const periodLabel = definition.period === "month"
                ? `${Number(awardDate.slice(5, 7))}月 ${definition.label}（${definition.league}）`
                : `${definition.label}（${definition.league}・${compactDate(awardDate)}）`;
            const notes = notesByPlayer.get(playerId) ?? [];
            if (!notes.some((note) => note.text === periodLabel)) {
                notes.push({
                    text: periodLabel,
                    href: article.url,
                    featuredAward: true,
                    awardPeriod: definition.period
                });
            }
            notesByPlayer.set(playerId, notes);
        });
        return notesByPlayer;
    };

    const getFeaturedPlayerData = async (entry, date, awardNotesByPlayer = new Map()) => {
        const playerId = Number(entry?.person?.id);
        const season = Number(date.slice(0, 4));
        if (!playerId) return { entry, notes: [], importance: 0 };
        const profile = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}?hydrate=xrefId`,
            `pregame:featured-profile-xref:${playerId}`
        ).then((payload) => payload?.people?.[0] ?? entry.person).catch(() => entry.person);
        const primaryType = String(profile?.primaryPosition?.type ?? "").toLowerCase();
        const primaryAbbreviation = String(profile?.primaryPosition?.abbreviation ?? "").toUpperCase();
        const isTwoWay = primaryType.includes("two-way") || primaryAbbreviation === "TWP";
        const isPitcher = primaryType === "pitcher" || primaryAbbreviation === "P";
        const groups = isTwoWay ? ["hitting", "pitching"] : [isPitcher ? "pitching" : "hitting"];
        const [hittingLogs, pitchingLogs, ...careers] = await Promise.all([
            groups.includes("hitting")
                ? getPlayerGameLog(playerId, season, "hitting").catch(() => [])
                : Promise.resolve([]),
            groups.includes("pitching")
                ? getPlayerGameLog(playerId, season, "pitching").catch(() => [])
                : Promise.resolve([]),
            ...groups.map((group) => getPlayerCareer(profile, group, previousDate(date)).catch(() => null))
        ]);
        const priorHittingLogs = hittingLogs.filter((split) => String(split?.date ?? "") < date);
        const previousGame = [...priorHittingLogs]
            .filter((split) => {
                const stat = split?.stat ?? {};
                return statNumber(stat.plateAppearances) > 0 || statNumber(stat.atBats) > 0;
            })
            .sort((a, b) => String(b?.date ?? "").localeCompare(String(a?.date ?? "")))[0];
        const notes = [];
        let importance = 0;
        const officialPlayerStatsUrl = (group, view) => {
            const url = new URL(`https://www.mlb.com/player/${playerId}`);
            url.searchParams.set(
                "stats",
                `${view}-r-${group === "pitching" ? "pitching" : "hitting"}-mlb`
            );
            if (view === "gamelogs") url.searchParams.set("year", String(season));
            return url.toString();
        };
        if (previousGame) {
            const stat = previousGame.stat ?? {};
            const hits = statNumber(stat.hits);
            const rbi = statNumber(stat.rbi);
            const homeRuns = statNumber(stat.homeRuns);
            const stolenBases = statNumber(stat.stolenBases);
            if (hits >= 2 || rbi >= 2 || homeRuns >= 1 || stolenBases >= 1) {
                const isYesterday = String(previousGame.date) === previousDate(date);
                const extras = [
                    homeRuns ? `${homeRuns}本塁打` : "",
                    stolenBases ? `${stolenBases}盗塁` : ""
                ].filter(Boolean).join("　");
                notes.push({
                    text: `${isYesterday ? "昨日" : "前戦"}（${compactDate(previousGame.date)} vs. ` +
                        `${teamCode(previousGame.opponent)}）` +
                        `${statNumber(stat.atBats)}打数${hits}安打${rbi}打点` +
                        (extras ? `　${extras}` : ""),
                    href: previousGame?.game?.gamePk
                        ? `https://www.mlb.com/gameday/${previousGame.game.gamePk}/final`
                        : officialPlayerStatsUrl("hitting", "gamelogs")
                });
                importance += hits + rbi + homeRuns * 2 + stolenBases;
            }
        }
        const featuredAwardNotes = awardNotesByPlayer.get(playerId) ?? [];
        notes.push(...featuredAwardNotes);
        importance += featuredAwardNotes.reduce(
            (total, note) => total + (note.awardPeriod === "month" ? 12 : 8),
            0
        );
        const franchiseRecordsUrl = getOfficialFranchiseRecordsUrl(entry?.teamId);
        const franchiseLeaders = await getFranchiseLeaders(entry?.teamId);
        const franchiseNotes = [];
        for (const group of groups) {
            const playerLeaders = franchiseLeaders.filter((leader) =>
                leader.group === group && leader.playerId === playerId
            );
            if (!playerLeaders.length) continue;
            const pregameStats = await getPlayerFranchiseStatsBeforeDate(
                profile,
                entry?.teamId,
                group,
                date
            );
            if (!pregameStats) continue;
            playerLeaders.forEach((officialPlayerLeader) => {
                const field = FRANCHISE_RECORD_FIELDS[officialPlayerLeader.category];
                const total = statNumber(pregameStats?.[field]);
                const categoryLeaders = franchiseLeaders
                    .filter((leader) =>
                        leader.group === group &&
                        leader.category === officialPlayerLeader.category &&
                        leader.playerId !== playerId
                    )
                    .sort((left, right) => right.value - left.value);
                const pregameRank = categoryLeaders.filter((leader) =>
                    leader.value > total
                ).length + 1;
                if (pregameRank > 15) return;

                const nextLeader = pregameRank > 1
                    ? categoryLeaders[pregameRank - 2]
                    : null;
                const remaining = nextLeader ? nextLeader.value + 1 - total : 0;
                const countdownLimit = officialPlayerLeader.category === "strikeouts" ? 10 : 5;
                const showCountdown = remaining >= 1 && remaining <= countdownLimit;
                if (!showCountdown) return;
                franchiseNotes.push({
                    text: `球団歴代${officialPlayerLeader.label}${pregameRank - 1}位` +
                        `（${nextLeader.value}）まであと${remaining}`,
                    href: franchiseRecordsUrl,
                    franchiseRecord: true
                });
            });
        }
        notes.push(...franchiseNotes);
        importance += franchiseNotes.length * 15;
        const streaks = getHittingStreaks(priorHittingLogs);
        const hittingGameLogUrl = officialPlayerStatsUrl("hitting", "gamelogs");
        if (streaks.hits.count >= 3) {
            notes.push({ text: formatHittingStreak(streaks.hits, "安打"), href: hittingGameLogUrl });
        }
        if (streaks.onBase.count >= 5) {
            notes.push({ text: formatHittingStreak(streaks.onBase, "出塁"), href: hittingGameLogUrl });
        }
        if (streaks.rbi.count >= 3) {
            notes.push({ text: formatHittingStreak(streaks.rbi, "打点"), href: hittingGameLogUrl });
        }
        importance += streaks.hits.count >= 3 ? streaks.hits.count : 0;
        importance += streaks.onBase.count >= 5 ? streaks.onBase.count : 0;
        const targetMonth = date.slice(0, 7);
        const monthlyHitting = priorHittingLogs
            .filter((split) => String(split?.date ?? "").slice(0, 7) === targetMonth)
            .reduce((totals, split) => {
                const stat = split?.stat ?? {};
                totals.plateAppearances += statNumber(stat.plateAppearances);
                totals.atBats += statNumber(stat.atBats);
                totals.hits += statNumber(stat.hits);
                return totals;
            }, { plateAppearances: 0, atBats: 0, hits: 0 });
        const monthlyAverage = monthlyHitting.atBats
            ? monthlyHitting.hits / monthlyHitting.atBats
            : 0;
        if (monthlyHitting.plateAppearances >= 20 && monthlyAverage >= 0.300) {
            notes.push({
                text: `${Number(date.slice(5, 7))}月 打率${formatAverage(monthlyAverage)}` +
                    `（${monthlyHitting.atBats}打数${monthlyHitting.hits}安打）`,
                href: hittingGameLogUrl,
                monthlyAverage: true
            });
        }
        groups.forEach((group, index) => {
            const milestoneNotes = remainingMilestones(careers[index], group);
            notes.push(...milestoneNotes.map((text) => ({
                text,
                href: officialPlayerStatsUrl(group, "career")
            })));
            importance += milestoneNotes.length * 10;
        });
        const pitchingIndex = groups.indexOf("pitching");
        if (pitchingIndex >= 0) {
            const priorPitchingLogs = pitchingLogs.filter((split) => String(split?.date ?? "") < date);
            const scorelessStreak = getPitchingScorelessStreak(priorPitchingLogs);
            if (scorelessStreak) {
                notes.push({
                    text: scorelessStreak.text,
                    href: getBaseballReferencePitchingGameLogUrl(profile, season) ||
                        officialPlayerStatsUrl("pitching", "gamelogs")
                });
                importance += scorelessStreak.value;
            }
            const allTimeStrikeoutNote = await getAllTimeStrikeoutCountdown(
                careers[pitchingIndex],
                playerId
            );
            if (allTimeStrikeoutNote) {
                notes.push({
                    text: allTimeStrikeoutNote,
                    href: officialPlayerStatsUrl("pitching", "career")
                });
                importance += 10;
            }
        }
        return { entry: { ...entry, person: profile }, notes, importance };
    };

    const createFeaturedPlayerRow = (featured) => {
        const entry = featured.entry;
        const row = el("li");
        row.classList.add("pregame-featured-player");
        const link = el("a", "pregame-player-link", playerName(entry?.person));
        link.href = `https://www.mlb.com/player/${entry?.person?.id}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.append(link);
        const monthlyAverageNote = featured.notes.find((note) => note.monthlyAverage);
        const featuredAwardNotes = featured.notes.filter((note) => note.featuredAward);
        const displayedNotes = featured.notes
            .filter((note) => !note.monthlyAverage && !note.featuredAward)
            .slice(0, 3);
        displayedNotes.push(...featuredAwardNotes);
        if (monthlyAverageNote) displayedNotes.push(monthlyAverageNote);
        displayedNotes.forEach((note) => {
            const noteLink = el("a", "pregame-featured-note", note.text);
            const statheadUrl = /自己最長(?:更新|タイ|.+まであと\d+)/.test(String(note.text ?? ""))
                ? window.MLBStatheadLinks?.playerStreakFinderUrl(entry?.person?.id)
                : "";
            noteLink.href = statheadUrl || note.href;
            noteLink.target = "_blank";
            noteLink.rel = "noopener noreferrer";
            noteLink.setAttribute(
                "aria-label",
                statheadUrl
                    ? `${playerName(entry?.person)}のStathead選手別ストリーク検索を開く`
                    : `${playerName(entry?.person)}：${note.text}のMLB公式情報を開く`
            );
            row.append(noteLink);
        });
        return row;
    };

    const getProbablePitcher = (game, feed, side) => {
        const probable = game?.teams?.[side]?.probablePitcher ?? feed?.gameData?.probablePitchers?.[side];
        if (probable?.id) return probable;
        const boxTeam = feed?.liveData?.boxscore?.teams?.[side];
        const firstPitcherId = Number(boxTeam?.pitchers?.[0]);
        return firstPitcherId ? getPlayerFromFeed(feed, firstPitcherId) : null;
    };

    const getStartingPitcherData = async (pitcher, date, opponent) => {
        if (!pitcher?.id) return null;
        const season = Number(date.slice(0, 4));
        const [seasonStats, profile] = await Promise.all([
            getPlayerSeasonStatsBeforeDate(pitcher.id, season, "pitching", date),
            fetchJson(
                `${API_ROOT}/v1/people/${pitcher.id}?hydrate=xrefId`,
                `pregame:starter-profile-xref:${pitcher.id}`
            ).then((payload) => payload?.people?.[0] ?? pitcher)
        ]);
        const careerLogs = await getPlayerCareerGameLog(profile, date, "pitching").catch(() => []);
        const recentAppearances = careerLogs
            .filter((split) => String(split?.date ?? "") < date && statNumber(split?.stat?.gamesPlayed) > 0)
            .sort((a, b) =>
                String(b?.date ?? "").localeCompare(String(a?.date ?? "")) ||
                statNumber(b?.game?.gamePk) - statNumber(a?.game?.gamePk)
            )
            .slice(0, 3);
        const opponentLogs = careerLogs.filter((split) =>
            Number(split?.opponent?.id) === Number(opponent?.id)
        );
        const matchup = opponentLogs.reduce((total, split) => {
            total.games += statNumber(split?.stat?.gamesPlayed);
            total.wins += statNumber(split?.stat?.wins);
            total.losses += statNumber(split?.stat?.losses);
            total.earnedRuns += statNumber(split?.stat?.earnedRuns);
            total.outs += statNumber(split?.stat?.outs);
            return total;
        }, { games: 0, wins: 0, losses: 0, earnedRuns: 0, outs: 0 });
        matchup.era = matchup.outs > 0
            ? ((matchup.earnedRuns * 27) / matchup.outs).toFixed(2)
            : "-.--";
        return {
            pitcher: profile,
            seasonStats,
            recentAppearances,
            hasCareerAppearance: careerLogs.length > 0,
            date,
            opponent,
            matchup
        };
    };

    const compactDate = (date) => {
        const [, month, day] = String(date ?? "").slice(0, 10).split("-");
        return month && day ? `${Number(month)}/${Number(day)}` : "日付不明";
    };

    const pitcherDecision = (stat) => {
        if (statNumber(stat?.wins) > 0) return "(W)";
        if (statNumber(stat?.losses) > 0) return "(L)";
        if (statNumber(stat?.saves) > 0) return "(S)";
        if (statNumber(stat?.holds) > 0) return "(H)";
        return "";
    };

    const appearanceLabel = (index) => ["前回登板", "前々回登板", "前々々回登板"][index] ?? "登板";

    const appearanceOpponent = (appearance) => `vs. ${teamCode(appearance?.opponent)}`;

    const appearanceGamedayUrl = (appearance) => {
        const gamePk = Number(appearance?.game?.gamePk);
        return gamePk ? `https://www.mlb.com/gameday/${gamePk}` : "";
    };

    const renderStartingPitcher = (data, team) => {
        const column = el("article", "pregame-starting-pitcher");
        const summary = el("div", "pregame-starting-summary");
        summary.append(el("div", "pregame-starting-team", teamCode(team)));
        if (!data) {
            summary.append(el("strong", "pregame-starting-name", "先発未定"));
            column.append(summary);
            return column;
        }
        const name = el("a", "pregame-starting-name", playerName(data.pitcher));
        name.href = `https://www.mlb.com/player/${data.pitcher.id}`;
        name.target = "_blank";
        name.rel = "noopener noreferrer";
        const appearances = statNumber(data.seasonStats?.gamesPlayed);
        const starts = statNumber(data.seasonStats?.gamesStarted);
        const seasonGrid = el("div", "pregame-starting-stats");
        seasonGrid.textContent = `${appearances}試合（${starts}先発）　` +
            `${statNumber(data.seasonStats?.wins)}勝${statNumber(data.seasonStats?.losses)}敗　` +
            `防御率${data.seasonStats?.era ?? "-"}`;
        summary.append(name, seasonGrid);
        column.append(summary);
        const baseballReferenceId = data.pitcher?.xrefIds?.find(
            (xref) => String(xref?.xrefType ?? "").toLowerCase() === "lahman"
        )?.xrefId;
        const matchupBox = el(
            baseballReferenceId ? "a" : "div",
            "pregame-pitcher-matchup"
        );
        if (baseballReferenceId) {
            const referenceUrl = new URL("https://www.baseball-reference.com/players/split.fcgi");
            referenceUrl.searchParams.set("id", baseballReferenceId);
            referenceUrl.searchParams.set("year", "Career");
            referenceUrl.searchParams.set("t", "p");
            matchupBox.href = referenceUrl.toString();
            matchupBox.target = "_blank";
            matchupBox.rel = "noopener noreferrer";
            matchupBox.setAttribute(
                "aria-label",
                `${playerName(data.pitcher)}のBaseball-Reference対戦別通算投手成績を新しいタブで開く`
            );
        }
        matchupBox.append(
            el("strong", "", `VS.${teamCode(data.opponent)}`),
            el("span", "",
                `${data.matchup.games}試合 ${data.matchup.wins}勝${data.matchup.losses}敗　` +
                `防御率${data.matchup.era}`
            )
        );
        column.append(matchupBox);
        const previousBox = el("div", "pregame-previous-start");
        if (data.recentAppearances.length) {
            data.recentAppearances.forEach((appearance, index) => {
                const stat = appearance?.stat ?? {};
                const walksAndHitByPitch = statNumber(stat.baseOnBalls) + statNumber(stat.hitBatsmen);
                const decision = pitcherDecision(stat);
                const row = el("div", "pregame-appearance-row");
                const gamedayUrl = appearanceGamedayUrl(appearance);
                const label = el(
                    gamedayUrl ? "a" : "strong",
                    "pregame-appearance-label",
                    appearanceLabel(index)
                );
                if (gamedayUrl) {
                    label.href = gamedayUrl;
                    label.target = "_blank";
                    label.rel = "noopener noreferrer";
                    label.setAttribute(
                        "aria-label",
                        `${appearanceLabel(index)}のGamedayを新しいタブで開く`
                    );
                }
                row.append(
                    label,
                    el("span", "pregame-appearance-date", compactDate(appearance?.date)),
                    el("span", "pregame-appearance-opponent", appearanceOpponent(appearance)),
                    el("span", "pregame-appearance-decision", decision),
                    el("span", "pregame-appearance-stat", `${stat.inningsPitched ?? "-"}回`),
                    el("span", "pregame-appearance-stat", `${statNumber(stat.runs)}失点`),
                    el("span", "pregame-appearance-stat", `${statNumber(stat.strikeOuts)}奪三振`),
                    el("span", "pregame-appearance-stat", `${walksAndHitByPitch}四死球`)
                );
                previousBox.append(row);
            });
        } else {
            previousBox.append(el("strong", "", data.hasCareerAppearance ? "今季初登板" : "キャリア初登板"));
        }
        column.append(previousBox);
        return column;
    };

    const renderGameDetail = async (gamePk) => {
        scrollPregameToTop();
        currentPlayerView = null;
        placeHeaderActions(true);
        savePregameSession("pregame-game", { gamePk: Number(gamePk) });
        dom.view.classList.remove("pregame-player-detail-active");
        setLoading(true);
        try {
            const game = gameIndex.get(Number(gamePk)) ?? currentContext?.scheduleGame ?? {};
            const [feed, articles] = await Promise.all([getFeed(gamePk), getGameArticles(gamePk)]);
            const date = String(feed?.gameData?.datetime?.officialDate ?? game?.officialDate ?? currentDate);
            const awayTeam = feed?.gameData?.teams?.away ?? game?.teams?.away?.team ?? {};
            const homeTeam = feed?.gameData?.teams?.home ?? game?.teams?.home?.team ?? {};
            const desktopDetail = isDesktopGameDetailLayout();
            const [awayTrend, homeTrend, standings, transactions, injuries, seriesStanding, sameDayGames] = await Promise.all([
                getTeamTrend(awayTeam.id, date),
                getTeamTrend(homeTeam.id, date),
                getStandingsSnapshot(date),
                getRecentTeamTransactions([awayTeam, homeTeam], date),
                getTeamInjuryReports([awayTeam, homeTeam], date),
                getCurrentSeriesStanding(gamePk, awayTeam.id, homeTeam.id, date),
                desktopDetail ? getSchedule(date).catch(() => []) : Promise.resolve([])
            ]);
            const pregameRecords = desktopDetail
                ? getTeamRecordsBeforeGame(
                    standings,
                    sameDayGames,
                    gamePk,
                    feed?.gameData?.datetime?.dateTime ?? game?.gameDate,
                    [awayTeam.id, homeTeam.id]
                )
                : null;
            setMatchupHeader(
                awayTeam,
                homeTeam,
                standings,
                game,
                feed,
                gamePk,
                articles,
                seriesStanding,
                pregameRecords
            );
            const grid = el("div", "pregame-detail-grid");

            const awayProbable = getProbablePitcher(game, feed, "away");
            const homeProbable = getProbablePitcher(game, feed, "home");
            const [awayStarter, homeStarter] = await Promise.all([
                getStartingPitcherData(awayProbable, date, homeTeam),
                getStartingPitcherData(homeProbable, date, awayTeam)
            ]);
            const startingSection = section("先発投手", "先発投手比較");
            startingSection.classList.add("pregame-span-12");
            const startingGrid = el("div", "pregame-starting-grid");
            startingGrid.append(
                renderStartingPitcher(awayStarter, awayTeam),
                renderStartingPitcher(homeStarter, homeTeam)
            );
            startingSection.append(startingGrid);
            grid.append(startingSection);

            const rosterBySide = {};
            [rosterBySide.away, rosterBySide.home] = await Promise.all([
                getFeaturedPlayers(feed, "away", date),
                getFeaturedPlayers(feed, "home", date)
            ]);
            const featuredAwards = await getRecentFeaturedAwards(date);
            const latestArticles = relevantLatestNews(
                [awayTeam, homeTeam],
                [...rosterBySide.away, ...rosterBySide.home],
                date,
                gamePk
            );
            const displayedArticles = mergeOfficialArticles(
                latestArticles,
                articles
            );

            const playersSection = section("注目選手", "記録・直近成績を優先");
            playersSection.classList.add("pregame-featured-section");
            const playerColumns = el("div", "pregame-team-columns");
            for (const [side, team] of [
                ["away", awayTeam],
                ["home", homeTeam]
            ]) {
                const column = el("div");
                column.append(el("h4", "pregame-team-heading", teamCode(team)));
                const list = el("ul", "pregame-data-list");
                const starters = rosterBySide[side];
                const featured = (await Promise.all(
                    starters.map((entry) => getFeaturedPlayerData(entry, date, featuredAwards))
                )).filter((player) => player.notes.length > 0).sort((a, b) =>
                    b.importance - a.importance ||
                    statNumber(b.entry?.seasonStats?.batting?.ops) -
                        statNumber(a.entry?.seasonStats?.batting?.ops)
                );
                if (featured.length) featured.forEach((player) => list.append(createFeaturedPlayerRow(player)));
                else list.append(el("li", "", "該当する注目情報なし"));
                column.append(list);
                playerColumns.append(column);
            }
            playersSection.append(playerColumns);

            const trendsSection = section("直近10試合 チーム動向");
            trendsSection.classList.add("pregame-team-trends-section");
            const trendColumns = el("div", "pregame-team-columns");
            [[awayTeam, awayTrend], [homeTeam, homeTrend]].forEach(([team, trend]) => {
                const column = el("div");
                column.append(el("h4", "pregame-team-heading", teamCode(team)));
                const metrics = el("div", "pregame-metric-grid");
                const season = Number(date.slice(0, 4));
                const scheduleUrl = getOfficialTeamScheduleUrl(team, date);
                const battingUrl = getOfficialTeamStatsUrl(team, season, "hitting");
                const pitchingUrl = getOfficialTeamStatsUrl(team, season, "pitching");
                const recentGamesMetric = el("div", "pregame-metric pregame-trend-record-metric");
                const recentRecord = el(
                    scheduleUrl ? "a" : "strong",
                    "pregame-metric-value pregame-trend-record",
                    `${trend.wins}勝${trend.losses}敗`
                );
                if (scheduleUrl) {
                    recentRecord.href = scheduleUrl;
                    recentRecord.target = "_blank";
                    recentRecord.rel = "noopener noreferrer";
                    recentRecord.setAttribute(
                        "aria-label",
                        `${teamCode(team)}の${date}を含むMLB公式スケジュールを新しいタブで開く`
                    );
                }
                recentGamesMetric.append(el("span", "", "勝敗"), recentRecord);
                const streakMetric = metric("連勝・連敗", trend.streakText);
                const historyMetric = el("div", "pregame-metric pregame-trend-history-metric");
                historyMetric.append(
                    el("span", "", "内容"),
                    renderTeamTrendHistory(trend.results)
                );
                const runTotalsMetric = el("div", "pregame-metric pregame-trend-runs-metric");
                runTotalsMetric.append(
                    el("span", "", "得点・失点"),
                    renderTeamRunTotals(trend.runsFor, trend.runsAgainst)
                );
                metrics.append(
                    recentGamesMetric,
                    streakMetric,
                    historyMetric,
                    runTotalsMetric,
                    metric("チーム打率", String(trend.avg), battingUrl ? {
                        href: battingUrl,
                        ariaLabel: `${teamCode(team)}の${season}年MLB公式チーム打撃成績を新しいタブで開く`
                    } : null),
                    metric("チーム防御率", String(trend.era), pitchingUrl ? {
                        href: pitchingUrl,
                        ariaLabel: `${teamCode(team)}の${season}年MLB公式チーム投手成績を新しいタブで開く`
                    } : null)
                );
                column.append(metrics);
                trendColumns.append(column);
            });
            trendsSection.append(trendColumns);

            const articleSection = section("MLB公式関連記事", "MLB・球団公式");
            articleSection.append(renderArticles(displayedArticles));

            const rosterSection = section("負傷者・ロースター情報", "MLB公式");
            const relatedColumns = el("div", "pregame-related-columns");
            const editorialColumn = el("div", "pregame-related-column");
            editorialColumn.append(
                el("h4", "pregame-related-heading", "負傷者情報"),
                renderArticles(injuries, "該当する負傷者情報はありません。")
            );
            const transactionColumn = el("div", "pregame-related-column");
            const transactionHeading = el("h4", "pregame-related-heading");
            const transactionHeadingLink = el("a", "pregame-related-heading-link", "トレード／ロースター異動");
            transactionHeadingLink.href = "https://www.mlb.com/transactions";
            transactionHeadingLink.target = "_blank";
            transactionHeadingLink.rel = "noopener noreferrer";
            transactionHeading.append(transactionHeadingLink);
            transactionColumn.append(
                transactionHeading,
                renderTransactions(transactions)
            );
            relatedColumns.append(editorialColumn, transactionColumn);
            rosterSection.append(relatedColumns);

            const lowerLayout = el("div", "pregame-lower-layout pregame-span-12");
            const rightColumn = el("div", "pregame-lower-right");
            rightColumn.append(trendsSection, articleSection, rosterSection);
            lowerLayout.append(playersSection, rightColumn);
            grid.append(lowerLayout);

            dom.content.replaceChildren(grid);
        } catch (error) {
            console.error(error);
            dom.content.replaceChildren(el("div", "pregame-error", error.message));
        } finally {
            setLoading(false);
        }
    };

    const open = async (context = {}) => {
        window.MLBAppNavigation?.enterPregameShell?.();
        currentContext = context;
        currentDate = String(
            context?.date ??
            context?.gameData?.gameData?.datetime?.officialDate ??
            document.getElementById("header-game-date")?.value?.split("|")?.[0] ??
            currentMlbDate()
        ).slice(0, 10);
        syncDateControl(currentDate);
        dom.viewer.classList.add("pregame-active");
        dom.view.hidden = false;
        if (context?.restoreView === "pregame-game" && Number(context?.gamePk)) {
            await renderGameDetail(Number(context.gamePk));
            return;
        }
        if (context?.restoreView === "pregame-player" && Number(context?.playerId)) {
            await renderPlayerDetail(
                Number(context.playerId),
                Number(context?.gamePk),
                Number(context?.team)
            );
            return;
        }
        await renderTop();
    };

    const close = ({ preserveShell = false } = {}) => {
        placeHeaderActions(false);
        dom.viewer.classList.remove("pregame-active");
        dom.view.hidden = true;
        if (!preserveShell) document.body.classList.remove("app-mode-pregame");
    };

    const renderSelectedDate = async () => {
        if (!currentPlayerView?.playerId) {
            await renderTop();
            return;
        }
        const games = await getSchedule(currentDate).catch(() => []);
        const teamId = Number(currentPlayerView.teamId);
        const game = teamId
            ? games.find((entry) => [
                Number(entry?.teams?.away?.team?.id),
                Number(entry?.teams?.home?.team?.id)
            ].includes(teamId))
            : null;
        await renderPlayerDetail(
            currentPlayerView.playerId,
            Number(game?.gamePk),
            teamId
        );
    };

    const initialize = () => {
        dom.viewer = document.querySelector(".viewer");
        dom.view = document.getElementById("pregame-view");
        dom.content = document.getElementById("pregame-content");
        dom.loading = document.getElementById("pregame-loading");
        dom.title = document.getElementById("pregame-title");
        dom.subtitle = document.getElementById("pregame-subtitle");
        dom.dateInput = document.getElementById("pregame-date");
        dom.mobileDateDisplay = document.getElementById("pregame-mobile-date-display");
        dom.previousDateButton = document.getElementById("pregame-prev-date-btn");
        dom.desktopTodayButton = document.getElementById("pregame-desktop-today-btn");
        dom.nextDateButton = document.getElementById("pregame-next-date-btn");
        dom.yesterdayButton = document.getElementById("pregame-yesterday-btn");
        dom.todayButton = document.getElementById("pregame-today-btn");
        dom.tomorrowButton = document.getElementById("pregame-tomorrow-btn");
        dom.homeButton = document.getElementById("pregame-home-btn");
        dom.closeButton = document.getElementById("pregame-close-btn");
        dom.headerActions = document.querySelector(".pregame-header-actions");
        dom.appHeader = document.querySelector(".app-header");
        if (!dom.view) return;
        if (dom.headerActions) {
            headerActionsAnchor = document.createComment("pregame header actions home");
            dom.headerActions.before(headerActionsAnchor);
        }
        dom.dateInput.addEventListener("change", async () => {
            const selectedDate = String(dom.dateInput.value ?? "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return;
            currentDate = selectedDate;
            syncDateControl(currentDate);
            await renderSelectedDate();
        });
        const moveDate = async (days) => {
            currentDate = shiftDate(currentDate || currentMlbDate(), days);
            syncDateControl(currentDate);
            await renderSelectedDate();
        };
        dom.previousDateButton?.addEventListener("click", () => moveDate(-1));
        dom.nextDateButton?.addEventListener("click", () => moveDate(1));
        dom.yesterdayButton?.addEventListener("click", () => moveDate(-1));
        const moveToToday = async () => {
            currentDate = currentEasternDate();
            syncDateControl(currentDate);
            await renderSelectedDate();
        };
        dom.desktopTodayButton?.addEventListener("click", moveToToday);
        dom.todayButton?.addEventListener("click", moveToToday);
        dom.tomorrowButton?.addEventListener("click", () => moveDate(1));
        dom.homeButton.addEventListener("click", renderTop);
        dom.closeButton.addEventListener("click", () => {
            if (window.MLBAppNavigation?.showScorebook) {
                window.MLBAppNavigation.showScorebook();
            } else {
                close();
            }
        });
        dom.content.addEventListener("click", (event) => {
            const playerCard = event.target.closest("[data-pregame-player]");
            if (playerCard) {
                renderPlayerDetail(
                    Number(playerCard.dataset.pregamePlayer),
                    Number(playerCard.dataset.pregameGame),
                    Number(playerCard.dataset.pregameTeam)
                );
                return;
            }
            const gameCard = event.target.closest("[data-pregame-game]");
            if (gameCard) {
                renderGameDetail(Number(gameCard.dataset.pregameGame));
            }
        });
        dom.view.addEventListener("click", async (event) => {
            const scoreButton = event.target.closest("[data-pregame-score-game]");
            if (!scoreButton) return;
            const gamePk = Number(scoreButton.dataset.pregameScoreGame);
            if (!gamePk || !window.MLBAppNavigation?.loadScorebookGame) return;
            await window.MLBAppNavigation.loadScorebookGame(gamePk);
        });
    };

    window.PregameInfo = { open, close, renderTop, renderGameDetail, renderPlayerDetail };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
