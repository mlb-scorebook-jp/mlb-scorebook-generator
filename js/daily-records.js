"use strict";

(() => {
    const API_ROOT = "https://statsapi.mlb.com/api";
    const CACHE_PREFIX = "mlb-daily-records-phase1-v15:";
    const MAX_CONCURRENT_GAMES = 3;
    const RECORD_THRESHOLDS = Object.freeze({
        inningHits: 2,
        inningHomeRuns: 2,
        inningRbi: 4,
        gameHomeRuns: 3,
        gameHits: 5,
        gameStolenBases: 4,
        gameRbi: 6,
        noHitInningRuns: 3,
        inningRuns: 8,
        teamInningHomeRuns: 3,
        combinedHomeRuns: 7,
        combinedPitchers: 12,
        teamWalks: 12,
        combinedWalks: 18,
        hitDeficitWin: 5
    });
    const CATEGORY_ORDER = ["japanese", "individual", "team", "special"];
    const CATEGORY_LABELS = Object.freeze({
        japanese: "日本人選手",
        individual: "個人記録",
        team: "チーム／試合記録",
        special: "特殊事象"
    });
    const RECORD_CATALOG = Object.freeze({
        JAPANESE_CAREER_HIGH: ["日本人選手キャリア最多", "自己最多", "career high"],
        JAPANESE_CAREER_WORST: ["日本人選手キャリアワースト", "自己ワースト", "career worst"],
        TWO_HR_SAME_INNING: ["1イニング2本塁打", "複数本塁打", "two homers inning"],
        TWO_HIT_SAME_INNING: ["1イニング2安打", "two hits inning"],
        LARGE_RBI_INNING: ["1イニング大量打点", "multiple RBI inning"],
        THREE_HR_GAME: ["1試合3本塁打", "3本塁打", "3HR", "3ホーマー", "three homer game"],
        FIVE_HIT_GAME: ["1試合5安打", "5安打", "five hit game"],
        SIX_HIT_GAME: ["1試合6安打", "6安打", "six hit game"],
        CYCLE: ["サイクル安打", "サイクル", "cycle"],
        LEADOFF_FIRST_PITCH_HR: ["初回先頭打者初球本塁打", "first pitch leadoff homer"],
        FOUR_SB_GAME: ["1試合4盗塁", "4盗塁", "four stolen bases"],
        LARGE_RBI_GAME: ["1試合大量打点", "大量打点"],
        TWO_OUTS_SAME_INNING: ["同一イニングで2アウト", "two outs same inning"],
        THREE_CONSECUTIVE_HR: ["3者連続本塁打", "back-to-back-to-back"],
        FOUR_CONSECUTIVE_HR: ["4者連続本塁打", "four consecutive homers"],
        WALKOFF_GRAND_SLAM: ["サヨナラ満塁本塁打", "walk-off grand slam"],
        FOUR_STRIKEOUT_INNING: ["1イニング4奪三振", "4奪三振", "4K", "1イニング4K", "4 strikeouts", "four strikeout inning"],
        IMMACULATE_INNING: ["イマキュレート・イニング", "イマキュレート", "9球3奪三振", "immaculate inning", "immaculate"],
        POSITION_PLAYER_STRIKEOUT: ["野手登板で奪三振", "position player strikeout"],
        POSITION_PLAYER_MULTI_STRIKEOUT: ["野手登板で複数奪三振"],
        POSITION_PLAYER_WIN: ["野手登板で勝利"],
        POSITION_PLAYER_SAVE: ["野手登板でセーブ"],
        LOW_HIT_WIN: ["1安打以下で勝利", "one-hit win"],
        RUN_WITHOUT_HIT: ["無安打で得点", "run without hit"],
        HIT_DEFICIT_WIN: ["少ない安打数で勝利"],
        LARGE_RUN_INNING: ["大量得点イニング"],
        LARGE_HR_INNING: ["1イニング大量本塁打"],
        COMBINED_LARGE_HR: ["両軍合計大量本塁打"],
        COMBINED_MANY_PITCHERS: ["両軍合計大量投手起用"],
        EXTREME_WALKS: ["極端に多い四球"],
        COMBINED_NO_HITTER: ["継投ノーヒッター", "combined no-hitter"],
        NO_HIT_LOSS: ["被安打0で敗戦", "no-hit loss"],
        TRIPLE_PLAY: ["三重殺", "triple play"],
        ALL_STARTERS_HIT: ["全先発野手安打"],
        ALL_STARTERS_SCORE: ["全先発野手得点"],
        FOUR_HR_GAME: ["1試合4本塁打", "4本塁打", "4HR", "four homer game"],
        SEVEN_HIT_GAME: ["1試合7安打", "7安打", "5安打", "6安打", "seven hit game"],
        TEN_RBI_GAME: ["1試合10打点", "10打点", "大量打点"],
        FIVE_SB_GAME: ["1試合5盗塁", "5盗塁", "4盗塁"],
        FOUR_DOUBLE_GAME: ["1試合4二塁打", "4二塁打"],
        THREE_TRIPLE_GAME: ["1試合3三塁打", "3三塁打"],
        SOLO_NO_HITTER: ["ノーヒットノーラン", "ノーヒッター", "単独ノーヒッター", "no hitter", "no-hitter"],
        SHUTOUT: ["完封", "完封勝利", "shutout"],
        ONE_HIT_COMPLETE_GAME: ["1安打完投", "one hitter"],
        NO_WALK_SHUTOUT: ["無四球完封", "四球なし完封"],
        FIFTEEN_STRIKEOUT_GAME: ["15奪三振", "15K", "20奪三振"],
        TWENTY_STRIKEOUT_GAME: ["20奪三振", "20K", "15奪三振"],
        MADDUX: ["100球未満完封", "マダックス", "Maddux"],
        POSITION_PLAYER_SCORELESS: ["野手登板で無失点"],
        POSITION_PLAYER_TWO_INNINGS: ["野手登板で2イニング", "野手登板で2回"],
        POSITION_PLAYER_NO_HIT: ["野手登板で被安打0", "野手登板でノーヒット"],
        HOMER_AND_PITCH: ["本塁打＋登板", "ホームランと登板"],
        MULTI_HIT_AND_PITCH: ["複数安打＋登板"],
        HOMER_AND_WIN: ["本塁打＋勝利投手"],
        HOMER_AND_SAVE: ["本塁打＋セーブ"],
        TEN_RUN_INNING: ["1イニング10得点", "大量得点イニング"],
        TWENTY_RUN_GAME: ["チーム20得点", "20得点", "25得点"],
        TWENTY_FIVE_RUN_GAME: ["チーム25得点", "25得点", "20得点"],
        TWENTY_HIT_TEAM_GAME: ["チーム20安打", "20安打"],
        SIX_HR_TEAM_GAME: ["チーム6本塁打", "6本塁打"],
        TEN_COMBINED_HR: ["両軍合計10本塁打", "10本塁打"],
        THIRTY_COMBINED_STRIKEOUTS: ["両軍合計30奪三振", "30奪三振"],
        NO_HIT_WIN: ["無安打で勝利", "0安打で勝利"],
        TEN_RUN_COMEBACK: ["10点差から逆転勝利", "10点差逆転"],
        NINTH_INNING_FIVE_RUN_COMEBACK: ["9回5点差から逆転勝利", "9回開始時5点差"],
        FIFTEEN_INNING_GAME: ["延長15回", "15回", "延長18回"],
        EIGHTEEN_INNING_GAME: ["延長18回", "18回", "延長15回"],
        PINCH_HIT_HOME_RUN: ["代打本塁打", "代打ホームラン", "ピンチヒッター", "pinch hit", "pinch-hit", "PH"],
        PINCH_HIT_GRAND_SLAM: ["代打満塁本塁打", "代打満塁ホームラン", "pinch-hit grand slam", "PH"],
        PINCH_HIT_WALKOFF_HOME_RUN: ["代打サヨナラ本塁打", "代打サヨナラホームラン", "pinch-hit walk-off home run", "PH"],
        PINCH_HIT_WALKOFF_GRAND_SLAM: ["代打サヨナラ満塁本塁打", "代打サヨナラ満塁ホームラン", "pinch-hit walk-off grand slam", "PH"],
        WALKOFF_HOME_RUN: ["サヨナラ本塁打", "サヨナラホームラン", "walk-off home run"],
        WALKOFF_HIT: ["サヨナラ安打", "サヨナラヒット", "walk-off hit"],
        WALKOFF_FORCED_RUN: ["サヨナラ押し出し", "サヨナラ四球", "サヨナラ死球", "walk-off walk", "walk-off hit by pitch"],
        WALKOFF_WILD_PITCH: ["サヨナラ暴投", "walk-off wild pitch"],
        WALKOFF_PASSED_BALL: ["サヨナラ捕逸", "walk-off passed ball"],
        WALKOFF_ERROR: ["サヨナラ失策", "サヨナラエラー", "walk-off error"],
        WALKOFF_BALK: ["サヨナラボーク", "walk-off balk"],
        WALKOFF_DROPPED_THIRD_STRIKE: ["サヨナラ振り逃げ", "振り逃げ", "walk-off dropped third strike"],
        WALKOFF_SPECIAL_PLAY: ["サヨナラ特殊プレー", "walk-off special play"],
        PERFECT_GAME: ["完全試合", "パーフェクトゲーム", "perfect game"],
        CROSS_DATE_CONSECUTIVE_HITS: [
            "日付を跨いで連続打数安打", "連続打数安打", "前日から連続安打",
            "consecutive at-bat hits"
        ],
        CROSS_DATE_CONSECUTIVE_HOME_RUNS: [
            "日付を跨いで連続打数本塁打", "連続打数本塁打", "前日から連続本塁打",
            "consecutive at-bat home runs", "consecutive at-bat homers"
        ],
        MLB_ALL_TIME_STRIKEOUT_RANK: [
            "MLB歴代奪三振", "MLB最多奪三振", "歴代奪三振", "通算奪三振順位",
            "all-time strikeouts", "career strikeout rank"
        ]
    });
    const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);
    const STRIKEOUT_EVENTS = new Set(["strikeout", "strikeout_double_play"]);
    const WALK_EVENTS = new Set(["walk", "intent_walk"]);
    const JAPANESE_CAREER_METRICS = Object.freeze({
        hitting: [
            { field: "hits", label: "安打", kind: "high" },
            { field: "homeRuns", label: "本塁打", kind: "high" },
            { field: "rbi", label: "打点", kind: "high" },
            { field: "runs", label: "得点", kind: "high" },
            { field: "stolenBases", label: "盗塁", kind: "high" },
            { field: "baseOnBalls", label: "四球", kind: "high" },
            { field: "totalBases", label: "塁打", kind: "high" },
            { field: "strikeOuts", label: "三振", kind: "worst" },
            { field: "groundIntoDoublePlay", label: "併殺打", kind: "worst" }
        ],
        pitching: [
            { field: "strikeOuts", label: "奪三振", kind: "high" },
            { field: "outs", label: "投球回", kind: "high", format: "innings" },
            { field: "runs", label: "失点", kind: "worst" },
            { field: "earnedRuns", label: "自責点", kind: "worst" },
            { field: "hits", label: "被安打", kind: "worst" },
            { field: "homeRuns", label: "被本塁打", kind: "worst" },
            { field: "baseOnBalls", label: "与四球", kind: "worst" },
            { field: "hitBatsmen", label: "与死球", kind: "worst" },
            { field: "wildPitches", label: "暴投", kind: "worst" }
        ]
    });

    const state = {
        date: "",
        controller: null,
        generation: 0,
        running: false,
        mode: "today"
    };
    const dom = {};
    const careerHistoryRequests = new Map();
    const crossDatePlayByPlayRequests = new Map();
    let allTimeStrikeoutLeadersRequest = null;

    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const text = (value) => String(value ?? "").trim();
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const dateLabel = (date) => text(date).replaceAll("-", "/");
    const inningHalf = (side) => side === "away" ? "表" : side === "home" ? "裏" : "";
    const pitchingInningHalf = (side) => inningHalf(side === "away" ? "home" : side === "home" ? "away" : "");
    const displayFact = (record) => {
        const inning = number(record?.inning);
        if (!inning) return text(record?.fact);
        const battingHalf = inningHalf(record?.battingSide);
        const pitchingHalf = pitchingInningHalf(record?.pitchingSide);
        if (record?.recordType === "TWO_HIT_SAME_INNING" && battingHalf && number(record?.details?.hits)) {
            return `${inning}回${battingHalf} 1イニングに${number(record?.details?.hits)}安打`;
        }
        if (record?.recordType === "TWO_HR_SAME_INNING" && battingHalf && number(record?.details?.homeRuns)) {
            return `${inning}回${battingHalf} 1イニングに${number(record?.details?.homeRuns)}本塁打`;
        }
        if (record?.recordType === "LARGE_RUN_INNING" && battingHalf && number(record?.details?.runs)) {
            return `${inning}回${battingHalf} 1イニングに${number(record?.details?.runs)}得点`;
        }
        if (record?.recordType === "LARGE_HR_INNING" && battingHalf && number(record?.details?.homeRuns)) {
            return `${inning}回${battingHalf} 1イニングに${number(record?.details?.homeRuns)}本塁打`;
        }
        if (record?.recordType === "IMMACULATE_INNING" && pitchingHalf) {
            return `${inning}回${pitchingHalf} イマキュレート・イニング達成`;
        }
        return text(record?.fact);
    };
    const nowIso = () => new Date().toISOString();
    const formatCheckedAt = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "-";
        return new Intl.DateTimeFormat("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(date);
    };
    const addDays = (date, amount) => {
        const value = new Date(`${date}T12:00:00Z`);
        value.setUTCDate(value.getUTCDate() + amount);
        return value.toISOString().slice(0, 10);
    };
    const currentSiteDate = () => window.MLBGameDate?.getTodayGameDate?.() ??
        new Date().toISOString().slice(0, 10);
    const normalizeNameKey = (value) => text(value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const playerDisplayName = (person) => {
        const fullName = text(person?.fullName);
        if (!fullName) return "選手不明";
        try {
            return NHK_PLAYER_NAMES?.[normalizeNameKey(fullName)] || fullName;
        } catch (_error) {
            return fullName;
        }
    };
    const teamCode = (team) => text(team?.abbreviation || team?.teamCode || team?.fileCode)
        .toUpperCase() || text(team?.name) || "MLB";
    const slugify = (value) => text(value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const gamedayUrl = (game) => {
        const officialUrl = window.MLBRecordsArchive?.gamedayUrlForGame?.(game);
        if (officialUrl) return officialUrl;
        const away = game?.teams?.away?.team ?? {};
        const home = game?.teams?.home?.team ?? {};
        const matchup = `${slugify(away.name)}-vs-${slugify(home.name)}`;
        const date = text(game.officialDate || state.date).replaceAll("-", "/");
        return `https://www.mlb.com/gameday/${matchup}/${date}/` +
            `${game.gamePk}/final`;
    };
    const isFinal = (game) => {
        const status = game?.status ?? {};
        const coded = text(status.codedGameState).toUpperCase();
        const abstract = text(status.abstractGameState).toLowerCase();
        const detailed = text(status.detailedState).toLowerCase();
        return coded === "F" || abstract === "final" || detailed === "final" ||
            detailed.includes("completed early");
    };

    const fetchJson = async (url, signal) => {
        const response = await fetch(url, { signal, cache: "no-store" });
        if (!response.ok) throw new Error(`MLB公式APIの取得に失敗しました（${response.status}）`);
        return {
            data: await response.json(),
            lastModified: response.headers.get("last-modified") || ""
        };
    };

    const fetchJapanesePlayers = async (season, signal) => {
        const { data } = await fetchJson(
            `${API_ROOT}/v1/sports/1/players?season=${season}&hydrate=currentTeam`,
            signal
        );
        const players = (data?.people ?? []).filter((person) =>
            globalThis.MLBJapanesePlayers?.isJapanesePlayer(person) ??
            text(person?.birthCountry ?? person?.country).toLowerCase() === "japan"
        );
        return new Map(players.map((person) => [number(person.id), person]));
    };

    const inningsToOuts = (value) => {
        const [innings = "0", remainder = "0"] = text(value).split(".");
        return number(innings) * 3 + Math.min(2, number(remainder));
    };
    const metricValue = (stat, metric) => metric.field === "outs"
        ? number(stat?.outs) || inningsToOuts(stat?.inningsPitched)
        : number(stat?.[metric.field]);
    const formatMetricValue = (value, metric) => {
        if (metric.format !== "innings") return `${value}${metric.label}`;
        const whole = Math.floor(value / 3);
        const remainder = value % 3;
        return `${whole}${remainder ? `回${remainder}/3` : "回"}`;
    };
    const fetchCareerGameLogs = async (playerId, group, game, signal) => {
        const targetDate = text(game?.officialDate || state.date);
        const cacheKey = `${playerId}:${group}`;
        let request = careerHistoryRequests.get(cacheKey);
        if (!request) request = (async () => {
            const yearResult = await fetchJson(
                `${API_ROOT}/v1/people/${playerId}/stats?stats=yearByYear&group=${group}&gameType=R`,
                signal
            );
            const seasons = unique((yearResult.data?.stats ?? []).flatMap((block) =>
                (block?.splits ?? []).map((split) => number(split?.season))
            )).filter(Boolean).sort((a, b) => a - b);
            const logs = [];
            for (const season of seasons) {
                const result = await fetchJson(
                    `${API_ROOT}/v1/people/${playerId}/stats?stats=gameLog&group=${group}` +
                    `&season=${season}&gameType=R`,
                    signal
                );
                (result.data?.stats ?? []).forEach((block) => {
                    (block?.splits ?? []).forEach((split) => {
                        logs.push({
                            date: text(split?.date).slice(0, 10),
                            gamePk: number(split?.game?.gamePk),
                            gameNumber: number(split?.game?.gameNumber),
                            stat: split?.stat ?? {}
                        });
                    });
                });
            }
            return logs;
        })();
        if (!careerHistoryRequests.has(cacheKey)) careerHistoryRequests.set(cacheKey, request);
        try {
            const logs = await request;
            return logs.filter((split) => {
                if (split.gamePk === number(game?.gamePk) || split.date > targetDate) return false;
                if (split.date !== targetDate) return true;
                const targetNumber = number(game?.gameNumber);
                return Boolean(targetNumber && split.gameNumber && split.gameNumber < targetNumber);
            }).map((split) => split.stat);
        } catch (error) {
            careerHistoryRequests.delete(cacheKey);
            throw error;
        }
    };
    const japaneseCareerRecords = async (game, boxscore, japanesePlayers, signal) => {
        const records = [];
        for (const side of ["away", "home"]) {
            const entries = Object.values(boxTeamForSide(boxscore, side)?.players ?? {});
            for (const entry of entries) {
                const playerId = number(entry?.person?.id);
                const player = japanesePlayers.get(playerId);
                if (!player) continue;
                for (const group of ["hitting", "pitching"]) {
                    const current = entry?.stats?.[group] ?? {};
                    const appeared = number(current?.gamesPlayed) > 0 ||
                        (group === "hitting"
                            ? number(current?.plateAppearances) > 0
                            : metricValue(current, { field: "outs" }) > 0 || number(current?.numberOfPitches) > 0);
                    if (!appeared) continue;
                    const history = await fetchCareerGameLogs(playerId, group, game, signal)
                        .catch(() => []);
                    if (!history.length) continue;
                    JAPANESE_CAREER_METRICS[group].forEach((metric) => {
                        const currentValue = metricValue(current, metric);
                        if (currentValue <= 0) return;
                        const priorMaximum = Math.max(...history.map((stat) => metricValue(stat, metric)));
                        if (currentValue < priorMaximum) return;
                        const tied = currentValue === priorMaximum;
                        const resultLabel = metric.kind === "worst" ? "キャリアワースト" : "キャリア最多";
                        records.push(makeRecord({
                            game,
                            boxscore,
                            recordType: metric.kind === "worst"
                                ? "JAPANESE_CAREER_WORST"
                                : "JAPANESE_CAREER_HIGH",
                            category: "japanese",
                            player,
                            side,
                            fact: `${formatMetricValue(currentValue, metric)}で${resultLabel}${tied ? "タイ" : ""}`,
                            details: { group, metric: metric.field, currentValue, priorMaximum, tied },
                            evidence: `当該試合前のMLB公式キャリアGame Log最大値 ${priorMaximum}`
                        }));
                    });
                }
            }
        }
        return records;
    };

    const fetchAllTimeStrikeoutLeaders = async (signal) => {
        if (allTimeStrikeoutLeadersRequest) return allTimeStrikeoutLeadersRequest;
        const params = new URLSearchParams({
            leaderCategories: "strikeouts",
            statGroup: "pitching",
            statType: "career",
            sportId: "1",
            limit: "20"
        });
        allTimeStrikeoutLeadersRequest = fetchJson(
            `${API_ROOT}/v1/stats/leaders?${params}`,
            signal
        ).then(({ data }) => (data?.leagueLeaders?.[0]?.leaders ?? [])
            .map((leader) => ({
                rank: number(leader?.rank),
                playerId: number(leader?.person?.id),
                value: number(leader?.value)
            }))
            .filter((leader) => leader.rank && leader.playerId && leader.value)
        ).catch((error) => {
            allTimeStrikeoutLeadersRequest = null;
            throw error;
        });
        return allTimeStrikeoutLeadersRequest;
    };

    const buildAllTimeStrikeoutRankRecords = async (game, boxscore, signal) => {
        // The leaderboard endpoint represents the present-day totals. Restrict
        // this comparison to today's MLB business date so an old scorecard is
        // never decorated with a player's later career rank.
        if (text(game?.officialDate) !== currentSiteDate()) return [];
        const leaders = await fetchAllTimeStrikeoutLeaders(signal).catch(() => []);
        if (!leaders.length) return [];
        const records = [];
        for (const side of ["away", "home"]) {
            const entries = Object.values(boxTeamForSide(boxscore, side)?.players ?? {});
            entries.forEach((entry) => {
                const gameStrikeouts = number(entry?.stats?.pitching?.strikeOuts);
                if (!gameStrikeouts) return;
                const playerId = number(entry?.person?.id);
                const official = leaders.find((leader) => leader.playerId === playerId);
                if (!official || official.rank > 10) return;
                const next = leaders.find((leader) => leader.rank > official.rank);
                if (!next) return;
                const beforeGame = official.value - gameStrikeouts;
                // Register the record only when this game's strikeouts moved the
                // pitcher past the player immediately below the achieved rank.
                if (beforeGame > next.value || official.value <= next.value) return;
                const fact = official.rank === 1
                    ? `MLB最多となる通算${official.value}奪三振達成`
                    : `MLB歴代${official.rank}位となる通算${official.value}奪三振達成`;
                records.push(makeRecord({
                    game,
                    boxscore,
                    recordType: "MLB_ALL_TIME_STRIKEOUT_RANK",
                    category: "individual",
                    fact,
                    player: entry.person,
                    side,
                    details: {
                        rank: official.rank,
                        careerStrikeouts: official.value,
                        gameStrikeouts,
                        beforeGameStrikeouts: beforeGame,
                        passedPlayerValue: next.value
                    },
                    evidence: "MLB公式 通算奪三振リーダー＋当該試合Boxscore"
                }));
            });
        }
        return records;
    };

    const readCache = (date) => {
        try {
            const value = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${date}`) || "null");
            return value?.date === date && Array.isArray(value?.records) ? value : null;
        } catch (_error) {
            return null;
        }
    };
    const writeCache = (payload) => {
        try {
            localStorage.setItem(`${CACHE_PREFIX}${payload.date}`, JSON.stringify(payload));
        } catch (error) {
            console.warn("本日の記録キャッシュを保存できませんでした。", error);
        }
    };

    const boxTeamForSide = (boxscore, side) => boxscore?.teams?.[side] ?? {};
    const scheduleTeamForSide = (game, side) => game?.teams?.[side]?.team ?? {};
    const sideTeam = (game, boxscore, side) => ({
        ...boxTeamForSide(boxscore, side)?.team,
        ...scheduleTeamForSide(game, side)
    });
    const oppositeSide = (side) => side === "away" ? "home" : "away";
    const battingSideForPlay = (play) => play?.about?.isTopInning === true ||
        text(play?.about?.halfInning).toLowerCase() === "top" ? "away" : "home";
    const inningKey = (side, inning) => `${side}:${number(inning)}`;
    const playerInBox = (boxscore, playerId) => {
        for (const side of ["away", "home"]) {
            const entry = boxscore?.teams?.[side]?.players?.[`ID${playerId}`];
            if (entry) return { entry, side };
        }
        return null;
    };
    const lineupStarters = (boxscore, side) => Object.values(
        boxscore?.teams?.[side]?.players ?? {}
    ).filter((entry) => {
        const order = Number.parseInt(entry?.battingOrder, 10);
        return Number.isFinite(order) && order % 100 === 0;
    });

    const collectOfficialArticlesFallback = async (gamePk, signal) => {
        const { data } = await fetchJson(`${API_ROOT}/v1/game/${gamePk}/content`, signal);
        const articles = [];
        const seen = new Set();
        const visit = (value) => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (value.type === "article" && value.slug && value.headline) {
                const url = `https://www.mlb.com/news/${value.slug}`;
                if (!seen.has(url)) {
                    seen.add(url);
                    articles.push({ headline: value.headline, officialUrl: url });
                }
            }
            Object.values(value).forEach(visit);
        };
        visit(data?.editorial);
        return articles;
    };
    const fetchOfficialArticles = async (gamePk, signal) => {
        if (window.MLBOfficialArticles?.fetch) {
            return window.MLBOfficialArticles.fetch(gamePk);
        }
        return collectOfficialArticlesFallback(gamePk, signal).catch(() => []);
    };

    const makeRecord = ({
        game, boxscore, recordType, category, fact, player = null, side = "away",
        inning = null, details = {}, evidence = ""
    }) => {
        const team = sideTeam(game, boxscore, side);
        const opponent = sideTeam(game, boxscore, oppositeSide(side));
        return {
            recordType,
            aliases: RECORD_CATALOG[recordType] ?? [],
            category,
            date: game.officialDate || state.date,
            season: number(String(game.officialDate || state.date).slice(0, 4)),
            gameType: text(game?.gameType || "R").toUpperCase(),
            gamePk: number(game.gamePk),
            playerId: player?.id ? number(player.id) : null,
            playerName: player ? playerDisplayName(player) : "",
            teamId: number(team?.id) || null,
            teamCode: teamCode(team),
            teamName: text(team?.name),
            opponentId: number(opponent?.id) || null,
            opponentCode: teamCode(opponent),
            opponentName: text(opponent?.name),
            inning: inning ? number(inning) : null,
            gameDate: text(game?.gameDate),
            battingSide: category !== "special" || player ? side : null,
            pitchingSide: recordType.includes("STRIKEOUT") ||
                recordType.includes("PITCHING") || recordType.includes("IMMACULATE")
                ? side : null,
            fact,
            details,
            evidence,
            apiStatus: "confirmed",
            historicalContext: { status: "needs-review", text: "" },
            gamedayUrl: gamedayUrl(game),
            articleUrls: [],
            feedUpdatedAt: ""
        };
    };

    const dedupeRecords = (records) => {
        const seen = new Set();
        const uniqueRecords = records.filter((record) => {
            const key = [record.gamePk, record.recordType, record.playerId, record.teamId,
                record.inning, record.fact].join(":");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const samePlayer = (left, right) => left.gamePk === right.gamePk && left.playerId &&
            left.playerId === right.playerId;
        const sameTeam = (left, right) => left.gamePk === right.gamePk && left.teamId === right.teamId;
        const upper = { THREE_HR_GAME: "FOUR_HR_GAME", FIVE_HIT_GAME: "SEVEN_HIT_GAME",
            SIX_HIT_GAME: "SEVEN_HIT_GAME", FOUR_SB_GAME: "FIVE_SB_GAME" };
        return uniqueRecords.filter((record) => {
            if (upper[record.recordType] && uniqueRecords.some((other) =>
                other.recordType === upper[record.recordType] && samePlayer(record, other))) return false;
            if (record.recordType === "LOW_HIT_WIN" && uniqueRecords.some((other) =>
                other.recordType === "NO_HIT_WIN" && sameTeam(record, other))) return false;
            if (record.recordType === "LARGE_RUN_INNING" && uniqueRecords.some((other) =>
                other.recordType === "TEN_RUN_INNING" && sameTeam(record, other) && other.inning === record.inning)) return false;
            if (record.recordType === "COMBINED_LARGE_HR" && uniqueRecords.some((other) =>
                other.recordType === "TEN_COMBINED_HR" && other.gamePk === record.gamePk)) return false;
            if (record.recordType === "SHUTOUT" && uniqueRecords.some((other) =>
                ["NO_WALK_SHUTOUT", "MADDUX"].includes(other.recordType) && samePlayer(record, other))) return false;
            const moreSpecific = {
                PINCH_HIT_HOME_RUN: ["PINCH_HIT_GRAND_SLAM", "PINCH_HIT_WALKOFF_HOME_RUN", "PINCH_HIT_WALKOFF_GRAND_SLAM"],
                PINCH_HIT_GRAND_SLAM: ["PINCH_HIT_WALKOFF_GRAND_SLAM"],
                PINCH_HIT_WALKOFF_HOME_RUN: ["PINCH_HIT_WALKOFF_GRAND_SLAM"],
                WALKOFF_HOME_RUN: ["PINCH_HIT_WALKOFF_HOME_RUN", "PINCH_HIT_WALKOFF_GRAND_SLAM", "WALKOFF_GRAND_SLAM"],
                WALKOFF_GRAND_SLAM: ["PINCH_HIT_WALKOFF_GRAND_SLAM"],
                SOLO_NO_HITTER: ["PERFECT_GAME"]
            }[record.recordType];
            if (moreSpecific?.some((type) => uniqueRecords.some((other) =>
                other.recordType === type && samePlayer(record, other)))) return false;
            return true;
        });
    };

    // Older reconstructed feeds may synthesize only the decisive strikes for a
    // strikeout (three apparent pitches with no balls).  Such events are useful
    // for the play result, but cannot prove pitch-sequence records.
    const hasVerifiedPitchSequence = (pitches) => pitches.length > 0 && pitches.every((pitch) =>
        Boolean(pitch?.startTime || pitch?.endTime) ||
        (Number.isFinite(Number(pitch?.pitchData?.coordinates?.pX)) &&
            Number.isFinite(Number(pitch?.pitchData?.coordinates?.pZ)))
    );

    const OFFICIAL_AT_BAT_OUT_EVENTS = new Set([
        "strikeout", "strikeout_double_play", "field_out", "force_out",
        "grounded_into_double_play", "double_play", "triple_play", "field_error",
        "fielders_choice", "fielders_choice_out"
    ]);
    const NON_AT_BAT_EVENTS = new Set([
        "walk", "intent_walk", "intentional_walk", "hit_by_pitch", "sac_fly",
        "sac_fly_double_play", "sac_bunt", "sac_bunt_double_play",
        "catcher_interf", "catcher_interference"
    ]);

    const officialAtBatResults = (plays, playerId) => (plays ?? [])
        .filter((play) => number(play?.matchup?.batter?.id) === number(playerId) &&
            play?.about?.isComplete !== false)
        .sort((left, right) =>
            number(left?.about?.atBatIndex) - number(right?.about?.atBatIndex)
        )
        .flatMap((play) => {
            const eventType = text(play?.result?.eventType).toLowerCase();
            if (HIT_EVENTS.has(eventType)) {
                return [{ hit: true, homeRun: eventType === "home_run" }];
            }
            if (OFFICIAL_AT_BAT_OUT_EVENTS.has(eventType)) {
                return [{ hit: false, homeRun: false }];
            }
            if (NON_AT_BAT_EVENTS.has(eventType)) return [];
            return [{ hit: false, homeRun: false }];
        });

    const countOpeningAtBatResults = (results, field) => {
        let count = 0;
        for (const result of results) {
            if (!result[field]) break;
            count += 1;
        }
        return count;
    };

    const fetchCrossDatePlayByPlay = async (gamePk, signal) => {
        const key = number(gamePk);
        if (!key) return null;
        if (crossDatePlayByPlayRequests.has(key)) {
            return crossDatePlayByPlayRequests.get(key);
        }
        const request = fetchJson(`${API_ROOT}/v1/game/${key}/playByPlay`, signal)
            .then((result) => result.data)
            .catch(() => {
                crossDatePlayByPlayRequests.delete(key);
                return null;
            });
        crossDatePlayByPlayRequests.set(key, request);
        return request;
    };

    const buildCrossDateAtBatRecords = async (
        game,
        playByPlay,
        boxscore,
        priorGamesByTeam,
        japanesePlayers,
        signal
    ) => {
        if (text(game?.gameType).toUpperCase() !== "R") return [];
        const currentDate = text(game?.officialDate || state.date);
        const currentPlays = playByPlay?.allPlays ?? [];
        const candidates = new Map();

        currentPlays.forEach((play) => {
            if (play?.about?.isComplete === false) return;
            const player = play?.matchup?.batter;
            const playerId = number(player?.id);
            if (!playerId || candidates.has(playerId)) return;
            const side = text(play?.about?.halfInning).toLowerCase() === "top"
                ? "away"
                : "home";
            const currentResults = officialAtBatResults(currentPlays, playerId);
            const hits = countOpeningAtBatResults(currentResults, "hit");
            const homeRuns = countOpeningAtBatResults(currentResults, "homeRun");
            if (!hits && !homeRuns) return;
            candidates.set(playerId, { player, side, hits, homeRuns });
        });

        const records = [];
        for (const candidate of candidates.values()) {
            const team = sideTeam(game, boxscore, candidate.side);
            const previousGames = priorGamesByTeam.get(number(team?.id)) ?? [];
            let hits = candidate.hits;
            let homeRuns = candidate.homeRuns;
            let hitActive = hits > 0;
            let homeRunActive = homeRuns > 0;
            let crossedDateForHits = false;
            let crossedDateForHomeRuns = false;

            for (const previousGame of previousGames) {
                if (!hitActive && !homeRunActive) break;
                const previousDate = text(previousGame?.officialDate);
                if (!previousDate || previousDate > currentDate ||
                    number(previousGame?.gamePk) === number(game?.gamePk)) continue;
                if (previousDate === currentDate &&
                    number(previousGame?.gameNumber) >= number(game?.gameNumber)) continue;
                const crossesDate = previousDate < currentDate;
                const previousPlayByPlay = await fetchCrossDatePlayByPlay(
                    previousGame?.gamePk,
                    signal
                );
                if (!previousPlayByPlay) break;
                const previousResults = officialAtBatResults(
                    previousPlayByPlay?.allPlays,
                    candidate.player?.id
                );
                if (!previousResults.length) continue;

                for (let index = previousResults.length - 1; index >= 0; index -= 1) {
                    const result = previousResults[index];
                    if (hitActive) {
                        if (result.hit) {
                            hits += 1;
                            crossedDateForHits ||= crossesDate;
                        } else hitActive = false;
                    }
                    if (homeRunActive) {
                        if (result.homeRun) {
                            homeRuns += 1;
                            crossedDateForHomeRuns ||= crossesDate;
                        } else homeRunActive = false;
                    }
                }
            }

            const add = (recordType, fact, count) => records.push(makeRecord({
                game,
                boxscore,
                recordType,
                category: "individual",
                fact,
                player: candidate.player,
                side: candidate.side,
                details: { atBats: count, crossedDate: true },
                evidence: "MLB公式Play-by-Play（前試合から当該試合）"
            }));
            if (crossedDateForHomeRuns && homeRuns >= 2) {
                add(
                    "CROSS_DATE_CONSECUTIVE_HOME_RUNS",
                    `${homeRuns}打数連続本塁打（前日から）`,
                    homeRuns
                );
            }
            const hitMinimum = japanesePlayers.has(number(candidate.player?.id)) ? 3 : 4;
            if (crossedDateForHits && hits >= hitMinimum && hits !== homeRuns) {
                add(
                    "CROSS_DATE_CONSECUTIVE_HITS",
                    `${hits}打数連続安打（前日から）`,
                    hits
                );
            }
        }
        return records;
    };

    const analyzeGame = async (game, playByPlay, boxscore, signal, { includeArticles = true } = {}) => {
        const records = [];
        const plays = (playByPlay?.allPlays ?? []).filter((play) => play?.about?.isComplete);
        const playerGame = new Map();
        const playerInnings = new Map();
        const pitcherInnings = new Map();
        const teamInnings = new Map();
        const teamPlateAppearances = { away: [], home: [] };

        const getPlayerGame = (player, side) => {
            const key = number(player?.id);
            if (!playerGame.has(key)) {
                playerGame.set(key, {
                    player, side, hits: 0, homeRuns: 0, rbi: 0, stolenBases: 0,
                    hitTypes: new Set()
                });
            }
            return playerGame.get(key);
        };
        const getPlayerInning = (player, side, inning) => {
            const key = `${number(player?.id)}:${side}:${number(inning)}`;
            if (!playerInnings.has(key)) {
                playerInnings.set(key, {
                    player, side, inning: number(inning), plateAppearances: 0,
                    hits: 0, homeRuns: 0, grandSlams: 0, rbi: 0, batterOuts: 0
                });
            }
            return playerInnings.get(key);
        };
        const getPitcherInning = (pitcher, side, inning) => {
            const key = `${number(pitcher?.id)}:${side}:${number(inning)}`;
            if (!pitcherInnings.has(key)) {
                pitcherInnings.set(key, {
                    pitcher, side, inning: number(inning), strikeouts: 0,
                    pitches: [], plateAppearances: 0
                });
            }
            return pitcherInnings.get(key);
        };

        plays.forEach((play) => {
            const battingSide = battingSideForPlay(play);
            const pitchingSide = oppositeSide(battingSide);
            const inning = number(play?.about?.inning);
            const batter = play?.matchup?.batter;
            const pitcher = play?.matchup?.pitcher;
            const eventType = text(play?.result?.eventType).toLowerCase();
            const gameLine = getPlayerGame(batter, battingSide);
            const inningLine = getPlayerInning(batter, battingSide, inning);
            const pitcherLine = getPitcherInning(pitcher, pitchingSide, inning);
            const pitches = (play?.playEvents ?? []).filter((event) => event?.isPitch);
            const isHit = HIT_EVENTS.has(eventType);
            const isHomeRun = eventType === "home_run";

            inningLine.plateAppearances += 1;
            inningLine.rbi += number(play?.result?.rbi);
            gameLine.rbi += number(play?.result?.rbi);
            pitcherLine.plateAppearances += 1;
            pitcherLine.pitches.push(...pitches);
            teamPlateAppearances[battingSide].push(play);

            if (isHit) {
                inningLine.hits += 1;
                gameLine.hits += 1;
                gameLine.hitTypes.add(eventType);
            }
            if (isHomeRun) {
                inningLine.homeRuns += 1;
                gameLine.homeRuns += 1;
                if (number(play?.result?.rbi) === 4) inningLine.grandSlams += 1;
            }
            if (play?.result?.isOut) inningLine.batterOuts += 1;
            if (STRIKEOUT_EVENTS.has(eventType)) pitcherLine.strikeouts += 1;

            (play?.runners ?? []).forEach((runner) => {
                const runnerEvent = text(runner?.details?.eventType).toLowerCase();
                if (!runnerEvent.startsWith("stolen_base")) return;
                const runnerPerson = runner?.details?.runner;
                if (!runnerPerson?.id) return;
                getPlayerGame(runnerPerson, battingSide).stolenBases += 1;
            });

            const key = inningKey(battingSide, inning);
            if (!teamInnings.has(key)) {
                teamInnings.set(key, { side: battingSide, inning, homeRuns: 0 });
            }
            if (isHomeRun) teamInnings.get(key).homeRuns += 1;
        });

        playerInnings.forEach((line) => {
            if (line.homeRuns >= RECORD_THRESHOLDS.inningHomeRuns) {
                records.push(makeRecord({
                    game, boxscore, recordType: "TWO_HR_SAME_INNING", category: "individual",
                    player: line.player, side: line.side, inning: line.inning,
                    fact: `${line.inning}回${inningHalf(line.side)} 1イニングに${line.homeRuns}本塁打`,
                    details: { homeRuns: line.homeRuns },
                    evidence: `同一イニングのhome_run ${line.homeRuns}件`
                }));
            }
            if (line.hits >= RECORD_THRESHOLDS.inningHits) {
                records.push(makeRecord({
                    game, boxscore, recordType: "TWO_HIT_SAME_INNING", category: "individual",
                    player: line.player, side: line.side, inning: line.inning,
                    fact: `${line.inning}回${inningHalf(line.side)} 1イニングに${line.hits}安打`, details: { hits: line.hits },
                    evidence: `同一イニングの安打イベント ${line.hits}件`
                }));
            }
            const isOnlyGrandSlamRbi = line.plateAppearances === 1 &&
                line.grandSlams >= 1 && line.rbi === 4;
            if (line.rbi >= RECORD_THRESHOLDS.inningRbi && !isOnlyGrandSlamRbi) {
                records.push(makeRecord({
                    game, boxscore, recordType: "LARGE_RBI_INNING", category: "individual",
                    player: line.player, side: line.side, inning: line.inning,
                    fact: `1イニングで${line.rbi}打点`, details: { rbi: line.rbi },
                    evidence: line.plateAppearances >= 2
                        ? `同一イニング${line.plateAppearances}打席のresult.rbi合計 ${line.rbi}`
                        : `同一イニングのresult.rbi合計 ${line.rbi}`
                }));
            }
            if (line.batterOuts >= 2) {
                records.push(makeRecord({
                    game, boxscore, recordType: "TWO_OUTS_SAME_INNING", category: "individual",
                    player: line.player, side: line.side, inning: line.inning,
                    fact: `${line.inning}回に2度打者アウト`,
                    details: { outPlateAppearances: line.batterOuts },
                    evidence: `同一イニングのisOut打席 ${line.batterOuts}件`
                }));
            }
        });

        playerGame.forEach((line) => {
            if (line.homeRuns >= RECORD_THRESHOLDS.gameHomeRuns) {
                records.push(makeRecord({
                    game, boxscore, recordType: "THREE_HR_GAME", category: "individual",
                    player: line.player, side: line.side,
                    fact: `1試合${line.homeRuns}本塁打`, details: { homeRuns: line.homeRuns },
                    evidence: `home_run ${line.homeRuns}件`
                }));
            }
            if (line.hits >= 6) {
                records.push(makeRecord({
                    game, boxscore, recordType: "SIX_HIT_GAME", category: "individual",
                    player: line.player, side: line.side,
                    fact: `1試合${line.hits}安打`, details: { hits: line.hits },
                    evidence: `安打イベント ${line.hits}件`
                }));
            } else if (line.hits >= RECORD_THRESHOLDS.gameHits) {
                records.push(makeRecord({
                    game, boxscore, recordType: "FIVE_HIT_GAME", category: "individual",
                    player: line.player, side: line.side,
                    fact: `1試合${line.hits}安打`, details: { hits: line.hits },
                    evidence: `安打イベント ${line.hits}件`
                }));
            }
            if (["single", "double", "triple", "home_run"].every((type) =>
                line.hitTypes.has(type))) {
                records.push(makeRecord({
                    game, boxscore, recordType: "CYCLE", category: "individual",
                    player: line.player, side: line.side, fact: "サイクル安打",
                    details: { hitTypes: [...line.hitTypes] },
                    evidence: "single・double・triple・home_runを同一試合で記録"
                }));
            }
            if (line.stolenBases >= RECORD_THRESHOLDS.gameStolenBases) {
                records.push(makeRecord({
                    game, boxscore, recordType: "FOUR_SB_GAME", category: "individual",
                    player: line.player, side: line.side,
                    fact: `1試合${line.stolenBases}盗塁`,
                    details: { stolenBases: line.stolenBases },
                    evidence: `stolen_baseイベント ${line.stolenBases}件`
                }));
            }
            if (line.rbi >= RECORD_THRESHOLDS.gameRbi) {
                records.push(makeRecord({
                    game, boxscore, recordType: "LARGE_RBI_GAME", category: "individual",
                    player: line.player, side: line.side,
                    fact: `1試合${line.rbi}打点`, details: { rbi: line.rbi },
                    evidence: `result.rbi合計 ${line.rbi}`
                }));
            }
        });

        for (const side of ["away", "home"]) {
            const firstPlay = teamPlateAppearances[side][0];
            const firstPitches = (firstPlay?.playEvents ?? []).filter((event) => event?.isPitch);
            if (number(firstPlay?.about?.inning) === 1 &&
                text(firstPlay?.result?.eventType).toLowerCase() === "home_run" &&
                firstPitches.length === 1 && hasVerifiedPitchSequence(firstPitches)) {
                records.push(makeRecord({
                    game, boxscore, recordType: "LEADOFF_FIRST_PITCH_HR", category: "individual",
                    player: firstPlay?.matchup?.batter, side,
                    fact: "初回先頭打者初球本塁打",
                    details: { inning: 1, pitchCount: 1 },
                    evidence: "チーム最初の打席が1球でhome_run"
                }));
            }

            let homeRunRun = [];
            const flushHomeRunRun = () => {
                if (homeRunRun.length >= 4) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "FOUR_CONSECUTIVE_HR", category: "individual",
                        player: homeRunRun[0]?.matchup?.batter, side,
                        fact: `${homeRunRun.length}者連続本塁打`,
                        details: { playerIds: homeRunRun.map((play) => play?.matchup?.batter?.id) },
                        evidence: `連続する完了打席でhome_run ${homeRunRun.length}件`
                    }));
                } else if (homeRunRun.length === 3) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "THREE_CONSECUTIVE_HR", category: "individual",
                        player: homeRunRun[0]?.matchup?.batter, side,
                        fact: "3者連続本塁打",
                        details: { playerIds: homeRunRun.map((play) => play?.matchup?.batter?.id) },
                        evidence: "連続する完了打席でhome_run 3件"
                    }));
                }
                homeRunRun = [];
            };
            teamPlateAppearances[side].forEach((play) => {
                if (text(play?.result?.eventType).toLowerCase() === "home_run") {
                    homeRunRun.push(play);
                } else {
                    flushHomeRunRun();
                }
            });
            flushHomeRunRun();
        }

        const lastPlay = plays.at(-1);
        const lastEventType = text(lastPlay?.result?.eventType).toLowerCase();
        const lastScoringRunners = (lastPlay?.runners ?? []).filter((runner) =>
            runner?.movement?.end === "score" && runner?.movement?.isOut !== true);
        const lastOccupiedBases = new Set((lastPlay?.runners ?? []).map((runner) =>
            text(runner?.movement?.start)).filter((base) => ["1B", "2B", "3B"].includes(base)));
        const isWalkoff = Boolean(lastPlay && battingSideForPlay(lastPlay) === "home" &&
            lastScoringRunners.length > 0 &&
            number(lastPlay?.result?.homeScore) > number(lastPlay?.result?.awayScore));
        const lastBatterId = number(lastPlay?.matchup?.batter?.id);
        const isPinchHit = (lastPlay?.playEvents ?? []).some((event) => {
            const eventType = text(event?.details?.eventType).toLowerCase();
            const description = `${text(event?.details?.event)} ${text(event?.details?.description)}`;
            return number(event?.player?.id) === lastBatterId &&
                ["offensive_substitution", "pinch_hitter"].includes(eventType) &&
                /pinch[- ]?hitter|代打/i.test(description);
        });
        const lastHalf = `${number(lastPlay?.about?.inning)}回裏`;
        const addLastPlayRecord = (recordType, fact, details = {}) => records.push(makeRecord({
            game, boxscore, recordType, category: "individual",
            player: lastPlay?.matchup?.batter, side: "home", inning: lastPlay?.about?.inning,
            fact, details: { inning: lastPlay?.about?.inning, ...details },
            evidence: "最終完了プレーのPBPでホームが勝ち越し"
        }));

        plays.filter((play) => text(play?.result?.eventType).toLowerCase() === "home_run")
            .forEach((play) => {
                const batterId = number(play?.matchup?.batter?.id);
                const pinchHit = (play?.playEvents ?? []).some((event) => {
                    const eventType = text(event?.details?.eventType).toLowerCase();
                    const description = `${text(event?.details?.event)} ${text(event?.details?.description)}`;
                    return number(event?.player?.id) === batterId &&
                        ["offensive_substitution", "pinch_hitter"].includes(eventType) &&
                        /pinch[- ]?hitter|代打/i.test(description);
                });
                if (!pinchHit) return;
                const scoringRunners = (play?.runners ?? []).filter((runner) =>
                    runner?.movement?.end === "score" && runner?.movement?.isOut !== true);
                const grandSlam = scoringRunners.length >= 4;
                const walkoff = play === lastPlay && isWalkoff;
                const recordType = walkoff && grandSlam ? "PINCH_HIT_WALKOFF_GRAND_SLAM"
                    : walkoff ? "PINCH_HIT_WALKOFF_HOME_RUN"
                    : grandSlam ? "PINCH_HIT_GRAND_SLAM" : "PINCH_HIT_HOME_RUN";
                const fact = walkoff && grandSlam ? "代打サヨナラ満塁本塁打"
                    : walkoff ? "代打サヨナラ本塁打"
                    : grandSlam ? "代打満塁本塁打" : "代打本塁打";
                records.push(makeRecord({ game, boxscore, recordType, category: "individual",
                    player: play?.matchup?.batter, side: battingSideForPlay(play), inning: play?.about?.inning,
                    fact, details: { inning: play?.about?.inning },
                    evidence: "同一打席PBPの代打交代アクションと本塁打" }));
            });
        if (isWalkoff && !isPinchHit) {
            if (lastEventType === "home_run" && lastScoringRunners.length < 4) {
                addLastPlayRecord("WALKOFF_HOME_RUN", "サヨナラ本塁打");
            } else if (["single", "double", "triple"].includes(lastEventType)) {
                addLastPlayRecord("WALKOFF_HIT", `${lastHalf} サヨナラ安打`, { eventType: lastEventType });
            } else if (["walk", "intent_walk", "intentional_walk", "hit_by_pitch"].includes(lastEventType) &&
                lastOccupiedBases.size === 3) {
                addLastPlayRecord("WALKOFF_FORCED_RUN", `${lastHalf} サヨナラ押し出し${lastEventType === "hit_by_pitch" ? "死球" : "四球"}`, { eventType: lastEventType });
            } else if (lastEventType === "wild_pitch") addLastPlayRecord("WALKOFF_WILD_PITCH", `${lastHalf} サヨナラ暴投`);
            else if (lastEventType === "passed_ball") addLastPlayRecord("WALKOFF_PASSED_BALL", `${lastHalf} サヨナラ捕逸`);
            else if (["field_error", "error"].includes(lastEventType)) addLastPlayRecord("WALKOFF_ERROR", `${lastHalf} サヨナラ失策`);
            else if (lastEventType === "balk") addLastPlayRecord("WALKOFF_BALK", `${lastHalf} サヨナラボーク`);
            else if (lastEventType.includes("strikeout")) addLastPlayRecord("WALKOFF_DROPPED_THIRD_STRIKE", `${lastHalf} サヨナラ振り逃げ`);
            else if (["fielders_choice", "sac_fly", "sac_bunt"].includes(lastEventType)) {
                const label = { fielders_choice: "野選", sac_fly: "犠牲フライ", sac_bunt: "犠牲バント" }[lastEventType];
                addLastPlayRecord("WALKOFF_SPECIAL_PLAY", `${lastHalf} サヨナラ${label}`, { eventType: lastEventType });
            }
        }
        if (lastPlay && battingSideForPlay(lastPlay) === "home" &&
            text(lastPlay?.result?.eventType).toLowerCase() === "home_run" &&
            number(lastPlay?.result?.homeScore) > number(lastPlay?.result?.awayScore) &&
            (lastPlay?.runners ?? []).filter((runner) => runner?.movement?.end === "score").length >= 4) {
            records.push(makeRecord({
                game, boxscore, recordType: "WALKOFF_GRAND_SLAM", category: "individual",
                player: lastPlay?.matchup?.batter, side: "home",
                fact: "サヨナラ満塁本塁打", details: { inning: lastPlay?.about?.inning },
                evidence: "最終打席のhome_runで4走者生還しホームが勝ち越し"
            }));
        }

        pitcherInnings.forEach((line) => {
            if (line.strikeouts >= 4) {
                records.push(makeRecord({
                    game, boxscore, recordType: "FOUR_STRIKEOUT_INNING", category: "individual",
                    player: line.pitcher, side: line.side, inning: line.inning,
                    fact: `${line.inning}回に${line.strikeouts}奪三振`,
                    details: { strikeouts: line.strikeouts },
                    evidence: `同一投手・同一イニングのstrikeout ${line.strikeouts}件`
                }));
            }
            const allStrikes = hasVerifiedPitchSequence(line.pitches) &&
                line.pitches.length === 9 && line.pitches.every((pitch) =>
                pitch?.details?.isStrike === true
            );
            if (line.plateAppearances === 3 && line.strikeouts === 3 && allStrikes) {
                records.push(makeRecord({
                    game, boxscore, recordType: "IMMACULATE_INNING", category: "individual",
                    player: line.pitcher, side: line.side, inning: line.inning,
                    fact: `${line.inning}回${pitchingInningHalf(line.side)} イマキュレート・イニング達成`,
                    details: { pitches: 9, strikeouts: 3, battersFaced: 3 },
                    evidence: "1投手が3打者を9球すべてストライクで3者連続三振"
                }));
            }
        });

        const triplePlay = plays.find((play) =>
            text(play?.result?.eventType).toLowerCase() === "triple_play" ||
            /triple play/i.test(text(play?.result?.event))
        );
        if (triplePlay) {
            const fieldingSide = oppositeSide(battingSideForPlay(triplePlay));
            records.push(makeRecord({
                game, boxscore, recordType: "TRIPLE_PLAY", category: "special",
                side: fieldingSide, inning: triplePlay?.about?.inning,
                fact: `${number(triplePlay?.about?.inning)}回 三重殺`,
                details: { description: triplePlay?.result?.description },
                evidence: "Play-by-Playのtriple_playイベント"
            }));
        }

        for (const side of ["away", "home"]) {
            const team = boxTeamForSide(boxscore, side);
            const opponent = boxTeamForSide(boxscore, oppositeSide(side));
            const batting = team?.teamStats?.batting ?? {};
            const opponentBatting = opponent?.teamStats?.batting ?? {};
            const teamRuns = number(game?.teams?.[side]?.score ?? batting.runs);
            const opponentRuns = number(game?.teams?.[oppositeSide(side)]?.score ?? opponentBatting.runs);
            const hits = number(batting.hits);
            const opponentHits = number(opponentBatting.hits);
            const won = teamRuns > opponentRuns;
            if (won && hits <= 1) {
                records.push(makeRecord({
                    game, boxscore, recordType: "LOW_HIT_WIN", category: "team", side,
                    fact: `${hits}安打で勝利`, details: { hits, runs: teamRuns },
                    evidence: `Boxscore ${hits}安打・${teamRuns}得点`
                }));
            }
            if (won && opponentHits - hits >= RECORD_THRESHOLDS.hitDeficitWin) {
                records.push(makeRecord({
                    game, boxscore, recordType: "HIT_DEFICIT_WIN", category: "team", side,
                    fact: `相手より${opponentHits - hits}本少ない安打数で勝利`,
                    details: { hits, opponentHits, difference: opponentHits - hits },
                    evidence: `Boxscore 安打数 ${hits}-${opponentHits}`
                }));
            }
            const starters = lineupStarters(boxscore, side);
            if (starters.length >= 9 && starters.every((entry) =>
                number(entry?.stats?.batting?.hits) >= 1)) {
                records.push(makeRecord({
                    game, boxscore, recordType: "ALL_STARTERS_HIT", category: "team", side,
                    fact: "先発野手全員安打", details: { starters: starters.length },
                    evidence: "battingOrder末尾00の先発打者全員が1安打以上"
                }));
            }
            if (starters.length >= 9 && starters.every((entry) =>
                number(entry?.stats?.batting?.runs) >= 1)) {
                records.push(makeRecord({
                    game, boxscore, recordType: "ALL_STARTERS_SCORE", category: "team", side,
                    fact: "先発野手全員得点", details: { starters: starters.length },
                    evidence: "battingOrder末尾00の先発打者全員が1得点以上"
                }));
            }
        }

        const innings = game?.linescore?.innings ?? [];
        innings.forEach((inning) => {
            for (const side of ["away", "home"]) {
                const line = inning?.[side] ?? {};
                if (number(line.runs) >= RECORD_THRESHOLDS.noHitInningRuns &&
                    number(line.hits) === 0) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "RUN_WITHOUT_HIT", category: "team", side,
                        inning: inning?.num, fact: `${number(inning?.num)}回 無安打で${number(line.runs)}得点`,
                        details: { runs: number(line.runs), hits: 0 },
                        evidence: "Linescoreで得点あり・安打0"
                    }));
                }
                if (number(line.runs) >= RECORD_THRESHOLDS.inningRuns) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "LARGE_RUN_INNING", category: "team", side,
                        inning: inning?.num, fact: `${number(inning?.num)}回${inningHalf(side)} 1イニングに${number(line.runs)}得点`,
                        details: { runs: number(line.runs) },
                        evidence: `Linescoreのイニング得点 ${number(line.runs)}`
                    }));
                }
            }
        });
        teamInnings.forEach((line) => {
            if (line.homeRuns >= RECORD_THRESHOLDS.teamInningHomeRuns) {
                records.push(makeRecord({
                    game, boxscore, recordType: "LARGE_HR_INNING", category: "team",
                    side: line.side, inning: line.inning,
                    fact: `${line.inning}回${inningHalf(line.side)} 1イニングに${line.homeRuns}本塁打`,
                    details: { homeRuns: line.homeRuns },
                    evidence: `同一チーム・同一イニングのhome_run ${line.homeRuns}件`
                }));
            }
        });

        const awayBatting = boxTeamForSide(boxscore, "away")?.teamStats?.batting ?? {};
        const homeBatting = boxTeamForSide(boxscore, "home")?.teamStats?.batting ?? {};
        const combinedHomeRuns = number(awayBatting.homeRuns) + number(homeBatting.homeRuns);
        const combinedWalks = number(awayBatting.baseOnBalls) + number(homeBatting.baseOnBalls);
        const awayPitchers = boxTeamForSide(boxscore, "away")?.pitchers?.length ?? 0;
        const homePitchers = boxTeamForSide(boxscore, "home")?.pitchers?.length ?? 0;
        const combinedPitchers = awayPitchers + homePitchers;
        if (combinedHomeRuns >= RECORD_THRESHOLDS.combinedHomeRuns) {
            records.push(makeRecord({
                game, boxscore, recordType: "COMBINED_LARGE_HR", category: "team",
                fact: `両軍合計${combinedHomeRuns}本塁打`,
                details: { combinedHomeRuns }, evidence: "両軍BoxscoreのhomeRuns合計"
            }));
        }
        if (combinedPitchers >= RECORD_THRESHOLDS.combinedPitchers) {
            records.push(makeRecord({
                game, boxscore, recordType: "COMBINED_MANY_PITCHERS", category: "team",
                fact: `両軍合計${combinedPitchers}投手を起用`,
                details: { awayPitchers, homePitchers }, evidence: "両軍Boxscoreのpitchers人数合計"
            }));
        }
        if (combinedWalks >= RECORD_THRESHOLDS.combinedWalks) {
            records.push(makeRecord({
                game, boxscore, recordType: "EXTREME_WALKS", category: "team",
                fact: `両軍合計${combinedWalks}四球`,
                details: { combinedWalks }, evidence: "両軍BoxscoreのbaseOnBalls合計"
            }));
        } else {
            for (const side of ["away", "home"]) {
                const walks = number(boxTeamForSide(boxscore, side)?.teamStats?.batting?.baseOnBalls);
                if (walks >= RECORD_THRESHOLDS.teamWalks) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "EXTREME_WALKS", category: "team", side,
                        fact: `チーム${walks}四球`, details: { walks },
                        evidence: "BoxscoreのbaseOnBalls"
                    }));
                }
            }
        }

        for (const side of ["away", "home"]) {
            const batting = boxTeamForSide(boxscore, side)?.teamStats?.batting ?? {};
            const runs = number(game?.teams?.[side]?.score ?? batting.runs);
            const opponentRuns = number(game?.teams?.[oppositeSide(side)]?.score);
            const hits = number(batting.hits);
            const opponentHits = number(
                boxTeamForSide(boxscore, oppositeSide(side))?.teamStats?.batting?.hits
            );
            const opposingPitchers = boxTeamForSide(boxscore, oppositeSide(side))?.pitchers?.length ?? 0;
            if (opponentHits === 0 && runs < opponentRuns) {
                records.push(makeRecord({
                    game, boxscore, recordType: "NO_HIT_LOSS", category: "special", side,
                    fact: "被安打0で敗戦", details: { runs, opponentRuns },
                    evidence: "Final Boxscoreで相手安打0かつ敗戦"
                }));
            }
            if (hits === 0 && runs === 0 && opposingPitchers >= 2 && opponentRuns > 0) {
                records.push(makeRecord({
                    game, boxscore, recordType: "COMBINED_NO_HITTER", category: "special",
                    side: oppositeSide(side), fact: `継投ノーヒッター（${opposingPitchers}投手）`,
                    details: { pitchers: opposingPitchers },
                    evidence: "Final Boxscoreで相手安打0・複数投手起用"
                }));
            }
        }

        const positionCandidates = [];
        for (const side of ["away", "home"]) {
            const team = boxTeamForSide(boxscore, side);
            (team?.pitchers ?? []).forEach((pitcherId) => {
                const entry = team?.players?.[`ID${pitcherId}`];
                if (!entry || number(entry?.stats?.pitching?.gamesPlayed) <= 0) return;
                const hasNonPitcherPosition = (entry?.allPositions ?? []).some((position) =>
                    text(position?.type).toLowerCase() !== "pitcher"
                );
                // Before the universal DH, ordinary pitchers also had a batting
                // order slot.  A battingOrder value therefore does not prove a
                // position player pitched; require an actual non-pitcher fielding
                // position in this game's Boxscore.
                if (hasNonPitcherPosition) {
                    positionCandidates.push({ side, playerId: number(pitcherId), entry });
                }
            });
        }
        if (positionCandidates.length) {
            const ids = unique(positionCandidates.map((candidate) => candidate.playerId));
            const people = await fetchJson(
                `${API_ROOT}/v1/people?personIds=${ids.join(",")}`,
                signal
            ).then((result) => result.data?.people ?? []).catch(() => []);
            const peopleById = new Map(people.map((person) => [number(person.id), person]));
            positionCandidates.forEach(({ side, playerId, entry }) => {
                const person = peopleById.get(playerId) ?? entry?.person;
                const positionType = text(person?.primaryPosition?.type).toLowerCase();
                const positionCode = text(person?.primaryPosition?.code).toUpperCase();
                if (positionType === "pitcher" || positionType.includes("two-way") ||
                    positionCode === "Y") return;
                const pitching = entry?.stats?.pitching ?? {};
                const strikeouts = number(pitching.strikeOuts);
                if (strikeouts >= 2) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "POSITION_PLAYER_MULTI_STRIKEOUT", category: "special",
                        player: person, side, fact: `野手登板で${strikeouts}奪三振`,
                        details: { strikeouts }, evidence: "野手登録選手のBoxscore投手成績"
                    }));
                } else if (strikeouts === 1) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "POSITION_PLAYER_STRIKEOUT", category: "special",
                        player: person, side, fact: "野手登板で奪三振",
                        details: { strikeouts }, evidence: "野手登録選手のBoxscore投手成績"
                    }));
                }
                if (number(pitching.wins) >= 1) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "POSITION_PLAYER_WIN", category: "special",
                        player: person, side, fact: "野手登板で勝利",
                        details: { wins: pitching.wins }, evidence: "野手登録選手のBoxscoreでwins=1"
                    }));
                }
                if (number(pitching.saves) >= 1) {
                    records.push(makeRecord({
                        game, boxscore, recordType: "POSITION_PLAYER_SAVE", category: "special",
                        player: person, side, fact: "野手登板でセーブ",
                        details: { saves: pitching.saves }, evidence: "野手登録選手のBoxscoreでsaves=1"
                    }));
                }
                const outs = number(pitching.outs);
                if (number(pitching.runs) === 0) {
                    records.push(makeRecord({ game, boxscore, recordType: "POSITION_PLAYER_SCORELESS",
                        category: "special", player: person, side, fact: "野手登板で無失点",
                        details: { outs, runs: 0 }, evidence: "野手登録選手のBoxscore投手成績" }));
                }
                if (outs >= 6) {
                    records.push(makeRecord({ game, boxscore, recordType: "POSITION_PLAYER_TWO_INNINGS",
                        category: "special", player: person, side,
                        fact: `野手登板で${Math.floor(outs / 3)}.${outs % 3}回`, details: { outs },
                        evidence: "野手登録選手のBoxscore投球アウト数" }));
                }
                if (number(pitching.hits) === 0) {
                    records.push(makeRecord({ game, boxscore, recordType: "POSITION_PLAYER_NO_HIT",
                        category: "special", player: person, side, fact: "野手登板で被安打0",
                        details: { hits: 0, outs }, evidence: "野手登録選手のBoxscore投手成績" }));
                }
            });
        }

        // Phase 1 game-base-safe records. These use only the same final
        // Boxscore/Linescore fields persisted by game-base schemaVersion 1.
        const perfectGamePbpVerified = (pitchingSide) => {
            const opponentPlays = plays.filter((play) =>
                battingSideForPlay(play) === oppositeSide(pitchingSide));
            return opponentPlays.length > 0 && !opponentPlays.some((play) => {
            const eventType = text(play?.result?.eventType).toLowerCase();
            if (["single", "double", "triple", "home_run", "walk", "intent_walk",
                "intentional_walk", "hit_by_pitch", "field_error", "catcher_interf",
                "catcher_interference"].includes(eventType)) return true;
            const batterId = number(play?.matchup?.batter?.id);
                return (play?.runners ?? []).some((runner) =>
                number(runner?.details?.runner?.id) === batterId &&
                runner?.movement?.isOut !== true &&
                Boolean(runner?.movement?.end));
            });
        };
        for (const side of ["away", "home"]) {
            const team = boxTeamForSide(boxscore, side);
            const opponent = boxTeamForSide(boxscore, oppositeSide(side));
            const batting = team?.teamStats?.batting ?? {};
            const opponentBatting = opponent?.teamStats?.batting ?? {};
            const runs = number(batting.runs ?? game?.teams?.[side]?.score);
            const opponentRuns = number(opponentBatting.runs ?? game?.teams?.[oppositeSide(side)]?.score);
            const won = runs > opponentRuns;
            (team?.batters ?? []).forEach((playerId) => {
                const entry = team?.players?.[`ID${playerId}`];
                const stats = entry?.stats?.batting ?? {};
                const add = (recordType, fact, details) => records.push(makeRecord({
                    game, boxscore, recordType, category: "individual", player: entry?.person,
                    side, fact, details, evidence: "Final Boxscore"
                }));
                if (number(stats.homeRuns) >= 4) add("FOUR_HR_GAME", `1試合${number(stats.homeRuns)}本塁打`, { homeRuns: number(stats.homeRuns) });
                if (number(stats.hits) >= 7) add("SEVEN_HIT_GAME", `1試合${number(stats.hits)}安打`, { hits: number(stats.hits) });
                if (number(stats.rbi) >= 10) add("TEN_RBI_GAME", `1試合${number(stats.rbi)}打点`, { rbi: number(stats.rbi) });
                if (number(stats.stolenBases) >= 5) add("FIVE_SB_GAME", `1試合${number(stats.stolenBases)}盗塁`, { stolenBases: number(stats.stolenBases) });
                if (number(stats.doubles) >= 4) add("FOUR_DOUBLE_GAME", `1試合${number(stats.doubles)}二塁打`, { doubles: number(stats.doubles) });
                if (number(stats.triples) >= 3) add("THREE_TRIPLE_GAME", `1試合${number(stats.triples)}三塁打`, { triples: number(stats.triples) });
            });
            const pitcherIds = team?.pitchers ?? [];
            const teamOuts = pitcherIds.reduce((sum, playerId) => sum +
                number(team?.players?.[`ID${playerId}`]?.stats?.pitching?.outs), 0);
            pitcherIds.forEach((playerId) => {
                const entry = team?.players?.[`ID${playerId}`];
                const pitching = entry?.stats?.pitching ?? {};
                const outs = number(pitching.outs);
                const complete = pitcherIds.length === 1 && outs === teamOuts;
                const shutout = complete && opponentRuns === 0;
                const add = (recordType, fact, details, category = "individual") => records.push(makeRecord({
                    game, boxscore, recordType, category, player: entry?.person, side, fact,
                    details, evidence: "Final Boxscore/Linescore"
                }));
                const scheduled = number(game?.linescore?.scheduledInnings);
                const played = number(game?.linescore?.currentInning || (game?.linescore?.innings ?? []).at(-1)?.num);
                if (complete && number(opponentBatting.hits) === 0 && pitcherIds.length === 1 &&
                    scheduled >= 9 && played >= scheduled && outs >= scheduled * 3) add("SOLO_NO_HITTER", "ノーヒットノーラン", { outs });
                if (perfectGamePbpVerified(side) && complete && number(opponentBatting.hits) === 0 &&
                    pitcherIds.length === 1 && scheduled >= 9 && played >= scheduled &&
                    outs >= scheduled * 3 && number(pitching.baseOnBalls) === 0 &&
                    number(pitching.hitBatsmen) === 0) {
                    add("PERFECT_GAME", "完全試合", { outs, battersFaced: number(pitching.battersFaced) });
                }
                if (shutout) add("SHUTOUT", `${Math.floor(outs / 3)}.${outs % 3}回を完封`, { outs });
                if (complete && number(pitching.hits) === 1) add("ONE_HIT_COMPLETE_GAME",
                    `${Math.floor(outs / 3)}.${outs % 3}回を1安打完投`, { outs, hits: 1, runs: number(pitching.runs) });
                if (shutout && number(pitching.baseOnBalls) === 0) add("NO_WALK_SHUTOUT", "無四球完封", { walks: 0 });
                const strikeouts = number(pitching.strikeOuts);
                if (strikeouts >= 20) add("TWENTY_STRIKEOUT_GAME", `${strikeouts}奪三振`, { strikeouts });
                else if (strikeouts >= 15) add("FIFTEEN_STRIKEOUT_GAME", `${strikeouts}奪三振`, { strikeouts });
                const pitches = Number(pitching.numberOfPitches ?? pitching.pitchesThrown);
                if (shutout && Number.isFinite(pitches) && pitches <= 99) add("MADDUX", `${pitches}球で完封`, { pitches });
                const battingEntry = team?.players?.[`ID${playerId}`]?.stats?.batting ?? {};
                if (number(battingEntry.homeRuns) >= 1) {
                    add("HOMER_AND_PITCH", "本塁打＋登板", { homeRuns: number(battingEntry.homeRuns), outs }, "special");
                    if (number(pitching.wins) >= 1) add("HOMER_AND_WIN", "本塁打＋勝利投手", { homeRuns: number(battingEntry.homeRuns) }, "special");
                    if (number(pitching.saves) >= 1) add("HOMER_AND_SAVE", "本塁打＋セーブ", { homeRuns: number(battingEntry.homeRuns) }, "special");
                }
                if (number(battingEntry.hits) >= 2) add("MULTI_HIT_AND_PITCH", `${number(battingEntry.hits)}安打＋登板`, { hits: number(battingEntry.hits), outs }, "special");
            });
            (game?.linescore?.innings ?? []).forEach((line) => {
                const inningRuns = number(line?.[side]?.runs);
                if (inningRuns >= 10) records.push(makeRecord({ game, boxscore,
                    recordType: "TEN_RUN_INNING", category: "team", side, inning: line?.num,
                    fact: `${number(line?.num)}回${inningHalf(side)} 1イニングに${inningRuns}得点`,
                    details: { runs: inningRuns }, evidence: "Linescore" }));
            });
            const teamHits = number(batting.hits);
            const teamHomers = number(batting.homeRuns);
            const teamRecord = (recordType, fact, details) => records.push(makeRecord({ game,
                boxscore, recordType, category: "team", side, fact, details, evidence: "Final Boxscore" }));
            if (runs >= 25) teamRecord("TWENTY_FIVE_RUN_GAME", `チーム${runs}得点`, { runs });
            else if (runs >= 20) teamRecord("TWENTY_RUN_GAME", `チーム${runs}得点`, { runs });
            if (teamHits >= 20) teamRecord("TWENTY_HIT_TEAM_GAME", `チーム${teamHits}安打`, { hits: teamHits });
            if (teamHomers >= 6) teamRecord("SIX_HR_TEAM_GAME", `チーム${teamHomers}本塁打`, { homeRuns: teamHomers });
            if (won && teamHits === 0) teamRecord("NO_HIT_WIN", "無安打で勝利", { runs });
            if (won && (game?.linescore?.innings ?? []).length) {
                let away = 0; let home = 0; let maximum = 0; let afterEight = null; let valid = true;
                for (const line of game.linescore.innings) {
                    if (line?.away?.runs == null || line?.home?.runs == null) { valid = false; break; }
                    if (number(line.num) === 9) afterEight = side === "away" ? home - away : away - home;
                    away += number(line.away.runs);
                    if (side === "home") maximum = Math.max(maximum, away - home);
                    home += number(line.home.runs);
                    if (side === "away") maximum = Math.max(maximum, home - away);
                }
                if (valid && maximum >= 10) teamRecord("TEN_RUN_COMEBACK", `${maximum}点差から逆転勝利`, { deficit: maximum });
                if (valid && afterEight >= 5) teamRecord("NINTH_INNING_FIVE_RUN_COMEBACK", `9回${afterEight}点差から逆転勝利`, { deficit: afterEight });
            }
        }
        const awayBat = boxTeamForSide(boxscore, "away")?.teamStats?.batting ?? {};
        const homeBat = boxTeamForSide(boxscore, "home")?.teamStats?.batting ?? {};
        const combinedHr = number(awayBat.homeRuns) + number(homeBat.homeRuns);
        const combinedSo = number(awayBat.strikeOuts) + number(homeBat.strikeOuts);
        if (combinedHr >= 10) records.push(makeRecord({ game, boxscore, recordType: "TEN_COMBINED_HR",
            category: "team", fact: `両軍合計${combinedHr}本塁打`, details: { homeRuns: combinedHr }, evidence: "Final Boxscore" }));
        if (combinedSo >= 30) records.push(makeRecord({ game, boxscore, recordType: "THIRTY_COMBINED_STRIKEOUTS",
            category: "team", fact: `両軍合計${combinedSo}奪三振`, details: { strikeouts: combinedSo }, evidence: "Final Boxscore" }));
        const playedInnings = number(game?.linescore?.currentInning || (game?.linescore?.innings ?? []).at(-1)?.num);
        if (playedInnings >= 18) records.push(makeRecord({ game, boxscore, recordType: "EIGHTEEN_INNING_GAME",
            category: "team", fact: `延長${playedInnings}回`, details: { innings: playedInnings }, evidence: "Linescore" }));
        else if (playedInnings >= 15) records.push(makeRecord({ game, boxscore, recordType: "FIFTEEN_INNING_GAME",
            category: "team", fact: `延長${playedInnings}回`, details: { innings: playedInnings }, evidence: "Linescore" }));

        const result = dedupeRecords(records);
        if (result.length && includeArticles) {
            const articles = await fetchOfficialArticles(game.gamePk, signal).catch(() => []);
            const links = articles.slice(0, 2).map((article) => ({
                headline: text(article?.headline),
                url: text(article?.officialUrl || article?.url)
            })).filter((article) => article.url);
            result.forEach((record) => { record.articleUrls = links; });
        }
        return result;
    };

    const analyzeOneGame = async (
        game,
        signal,
        japanesePlayers,
        priorGamesByTeam = new Map(),
        options = {}
    ) => {
        // Keep the archive builder's former four-argument call compatible. It
        // intentionally supplies no prior-game map, so historical backfills are
        // not changed by this daily-only feature.
        if (!(priorGamesByTeam instanceof Map)) {
            options = priorGamesByTeam ?? {};
            priorGamesByTeam = new Map();
        }
        const { includeArticles = true } = options;
        const [playResult, boxResult] = await Promise.all([
            fetchJson(`${API_ROOT}/v1/game/${game.gamePk}/playByPlay`, signal),
            fetchJson(`${API_ROOT}/v1/game/${game.gamePk}/boxscore`, signal)
        ]);
        const records = await analyzeGame(
            game,
            playResult.data,
            boxResult.data,
            signal,
            { includeArticles }
        );
        records.push(...await buildCrossDateAtBatRecords(
            game,
            playResult.data,
            boxResult.data,
            priorGamesByTeam,
            japanesePlayers,
            signal
        ));
        records.push(...await buildAllTimeStrikeoutRankRecords(
            game,
            boxResult.data,
            signal
        ));
        const careerRecords = await japaneseCareerRecords(game, boxResult.data, japanesePlayers, signal);
        const japaneseIds = new Set(japanesePlayers.keys());
        records.forEach((record) => {
            if (record.playerId && japaneseIds.has(record.playerId)) record.category = "japanese";
        });
        records.push(...careerRecords);
        const updatedAt = playResult.lastModified || boxResult.lastModified || nowIso();
        records.forEach((record) => { record.feedUpdatedAt = updatedAt; });
        return records;
    };

    const mapWithConcurrency = async (items, limit, worker, onProgress) => {
        const results = new Array(items.length);
        let cursor = 0;
        let completed = 0;
        const run = async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                results[index] = await worker(items[index], index);
                completed += 1;
                onProgress?.(completed, items.length);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
        return results;
    };

    const setRunning = (running, message = "") => {
        state.running = running;
        dom.progress.hidden = !running || state.mode === "search";
        dom.progressText.textContent = message || "MLB公式データを調査しています…";
        [dom.date, dom.prev, dom.today, dom.next, dom.refresh].forEach((node) => {
            node.disabled = running;
        });
    };
    const renderSummary = (payload, fromCache = false) => {
        dom.summary.replaceChildren();
        const parts = [
            ["対象日", dateLabel(payload.date)],
            ["試合", `${payload.totalGames}試合`],
            ["解析済み", `${payload.finalGames}試合`],
            ["未終了", `${payload.unfinishedGames}試合`],
            ["検出", `${payload.records.length}件`],
            ["最終調査", formatCheckedAt(payload.checkedAt)]
        ];
        if (fromCache) parts.push(["表示", "日付別キャッシュ"]);
        parts.forEach(([label, value]) => {
            const item = document.createElement("span");
            const strong = document.createElement("strong");
            strong.textContent = `${label}：`;
            item.append(strong, document.createTextNode(value));
            dom.summary.append(item);
        });
    };
    const link = (label, url, title = "") => {
        const anchor = document.createElement("a");
        anchor.textContent = label;
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        if (title) anchor.title = title;
        return anchor;
    };
    const showRecordHistory = async (recordType, button = null) => {
        if (button) {
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            button.textContent = "読み込み中…";
        }
        try {
            await setMode("search", { recordType });
        } finally {
            if (button?.isConnected) {
                button.disabled = false;
                button.removeAttribute("aria-busy");
                button.textContent = "全履歴を見る";
            }
        }
    };
    const renderRecord = (record, { showPrevious = true } = {}) => {
        const card = document.createElement("article");
        card.className = "daily-record-card";
        card.dataset.recordType = record.recordType;
        const header = document.createElement("div");
        header.className = "daily-record-card-header";
        const team = document.createElement("span");
        team.className = "daily-record-team";
        team.textContent = record.teamCode;
        const subject = document.createElement("span");
        subject.className = "daily-record-subject";
        subject.textContent = record.playerName ||
            `${record.teamCode} 対 ${record.opponentCode || "相手"}`;
        const achievedDate = document.createElement("time");
        achievedDate.className = "daily-record-date";
        achievedDate.dateTime = text(record.date);
        achievedDate.textContent = /^\d{4}-\d{2}-\d{2}$/.test(text(record.date))
            ? text(record.date).replaceAll("-", "/")
            : "";
        header.append(team, subject);
        if (achievedDate.textContent) header.append(achievedDate);
        const fact = document.createElement("p");
        fact.className = "daily-record-fact";
        fact.textContent = displayFact(record);
        const links = document.createElement("div");
        links.className = "daily-record-links";
        links.append(link("Gameday", record.gamedayUrl));
        (record.articleUrls ?? []).forEach((article, index) => {
            links.append(link(
                index ? `MLB公式記事 ${index + 1}` : "MLB公式記事",
                article.url,
                article.headline
            ));
        });
        card.append(header, fact, links);
        if (showPrevious && window.MLBRecordsArchive) {
            const previous = window.MLBRecordsArchive.previous(record);
            const previousLine = document.createElement("p");
            previousLine.className = "daily-record-previous";
            if (previous) {
                previousLine.append(document.createTextNode(
                    `前回：${dateLabel(previous.date)}　${previous.playerName || previous.teamCode}` +
                    `${previous.teamCode ? `（${previous.teamCode}）` : ""}`
                ));
                if (previous.gamedayUrl) {
                    previousLine.append(link("前回のGameday", previous.gamedayUrl));
                }
            } else {
                previousLine.append(document.createTextNode("アーカイブ内に過去例なし"));
            }
            const history = document.createElement("button");
            history.type = "button";
            history.className = "daily-record-history-button";
            history.textContent = "全履歴を見る";
            history.addEventListener("click", () => showRecordHistory(record.recordType, history));
            previousLine.append(history);
            card.append(previousLine);
        }
        return card;
    };

    const populateArchiveSeasons = () => {
        const current = dom.searchSeason.value || "all";
        const seasons = window.MLBRecordsArchive.getSeasons();
        dom.searchSeason.replaceChildren(new Option("全シーズン", "all"));
        seasons.forEach((season) => dom.searchSeason.append(new Option(`${season}年`, String(season))));
        dom.searchSeason.value = seasons.includes(number(current)) ? current : "all";
    };
    const renderArchiveSearch = async ({ recordType = "" } = {}) => {
        const results = window.MLBRecordsArchive.search({
            query: recordType ? "" : dom.searchInput.value,
            recordType,
            japaneseOnly: dom.searchJapanese.checked,
            category: dom.searchCategory.value,
            season: dom.searchSeason.value,
            order: dom.searchOrder.value
        });
        dom.searchSummary.textContent = `${results.length}件`;
        dom.searchResults.replaceChildren();
        if (!results.length) {
            const empty = document.createElement("div");
            empty.className = "daily-records-empty";
            empty.textContent = "条件に一致する記録はありません";
            dom.searchResults.append(empty);
            return;
        }
        const batchSize = 200;
        let rendered = 0;
        const renderNextBatch = () => {
            const end = Math.min(rendered + batchSize, results.length);
            results.slice(rendered, end).forEach((record) =>
                dom.searchResults.append(renderRecord(record, { showPrevious: false }))
            );
            rendered = end;
            if (rendered < results.length) {
                const more = document.createElement("button");
                more.type = "button";
                more.className = "daily-record-history-button";
                more.textContent = `さらに表示（${rendered}/${results.length}件）`;
                more.addEventListener("click", () => {
                    more.remove();
                    renderNextBatch();
                }, { once: true });
                dom.searchResults.append(more);
            }
        };
        renderNextBatch();
    };
    const setMode = async (mode, { recordType = "" } = {}) => {
        state.mode = mode === "search" ? "search" : "today";
        const searching = state.mode === "search";
        dom.modeToday.classList.toggle("active", !searching);
        dom.modeSearch.classList.toggle("active", searching);
        dom.searchPanel.hidden = !searching;
        dom.summary.hidden = searching;
        dom.progress.hidden = searching || !state.running;
        dom.content.hidden = searching;
        if (searching) {
            if (recordType) dom.searchInput.value = recordType;
            dom.archiveLoading.hidden = false;
            dom.archiveLoadingText.textContent = "記録アーカイブを読み込んでいます…";
            dom.searchSummary.hidden = true;
            dom.searchResults.hidden = true;
            [dom.searchInput, dom.searchJapanese, dom.searchCategory, dom.searchSeason, dom.searchOrder]
                .forEach((node) => { node.disabled = true; });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const loadingStartedAt = performance.now();
            try {
                await window.MLBRecordsArchive.load();
                populateArchiveSeasons();
                dom.archiveRange.textContent = `検索対象期間：${window.MLBRecordsArchive.rangeLabel()}`;
                await renderArchiveSearch({ recordType });
            } finally {
                const remaining = 250 - (performance.now() - loadingStartedAt);
                if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
                dom.archiveLoading.hidden = true;
                dom.searchSummary.hidden = false;
                dom.searchResults.hidden = false;
                [dom.searchInput, dom.searchJapanese, dom.searchCategory, dom.searchSeason, dom.searchOrder]
                    .forEach((node) => { node.disabled = false; });
            }
        }
    };
    const renderPayload = (payload, fromCache = false) => {
        renderSummary(payload, fromCache);
        dom.content.replaceChildren();
        if (!payload.records.length) {
            const empty = document.createElement("div");
            empty.className = "daily-records-empty";
            empty.textContent = payload.finalGames
                ? "登録済みルールに該当する記録はありません"
                : "解析対象となるFinal試合はありません";
            dom.content.append(empty);
            return;
        }
        CATEGORY_ORDER.forEach((category) => {
            const records = payload.records.filter((record) => record.category === category);
            if (!records.length) return;
            const section = document.createElement("section");
            section.className = "daily-records-category";
            const heading = document.createElement("h3");
            heading.textContent = `${CATEGORY_LABELS[category]}　${records.length}件`;
            const list = document.createElement("div");
            list.className = "daily-records-list";
            records.forEach((record) => list.append(renderRecord(record)));
            section.append(heading, list);
            dom.content.append(section);
        });
    };
    const renderError = (error) => {
        dom.summary.replaceChildren();
        dom.content.replaceChildren();
        const message = document.createElement("div");
        message.className = "daily-records-error";
        message.textContent = error?.message || "本日の記録を調査できませんでした。";
        dom.content.append(message);
    };

    const investigate = async ({ force = false } = {}) => {
        const date = state.date;
        if (!force) {
            const cached = readCache(date);
            if (cached) {
                await window.MLBRecordsArchive?.absorb(cached.records);
                renderPayload(cached, true);
                return;
            }
        }
        state.controller?.abort();
        state.controller = new AbortController();
        state.generation += 1;
        const generation = state.generation;
        setRunning(true, "当日の試合一覧を取得しています…");
        dom.content.replaceChildren();
        try {
            const params = new URLSearchParams({
                sportId: "1",
                date,
                hydrate: "team,linescore,venue"
            });
            const { data: schedule } = await fetchJson(
                `${API_ROOT}/v1/schedule?${params}`,
                state.controller.signal
            );
            if (generation !== state.generation) return;
            const games = (schedule?.dates ?? []).flatMap((item) => item?.games ?? [])
                .filter((game) => number(game?.gamePk));
            const finalGames = games.filter(isFinal);
            const historyParams = new URLSearchParams({
                sportId: "1",
                startDate: addDays(date, -30),
                endDate: addDays(date, -1),
                gameType: "R",
                hydrate: "team"
            });
            const { data: historySchedule } = await fetchJson(
                `${API_ROOT}/v1/schedule?${historyParams}`,
                state.controller.signal
            ).catch(() => ({ data: { dates: [] } }));
            const priorGamesByTeam = new Map();
            [
                ...(historySchedule?.dates ?? []).flatMap((item) => item?.games ?? []),
                ...finalGames
            ]
                .filter((game) => isFinal(game) && text(game?.gameType).toUpperCase() === "R")
                .sort((left, right) =>
                    text(right?.officialDate).localeCompare(text(left?.officialDate)) ||
                    number(right?.gameNumber) - number(left?.gameNumber)
                )
                .forEach((game) => {
                    [game?.teams?.away?.team?.id, game?.teams?.home?.team?.id]
                        .map(number)
                        .filter(Boolean)
                        .forEach((teamId) => {
                            if (!priorGamesByTeam.has(teamId)) {
                                priorGamesByTeam.set(teamId, []);
                            }
                            priorGamesByTeam.get(teamId).push(game);
                        });
                });
            setRunning(true, "日本人選手の対象者を確認しています…");
            const japanesePlayers = await fetchJapanesePlayers(
                number(date.slice(0, 4)),
                state.controller.signal
            );
            const gameRecords = await mapWithConcurrency(
                finalGames,
                MAX_CONCURRENT_GAMES,
                (game) => analyzeOneGame(
                    game,
                    state.controller.signal,
                    japanesePlayers,
                    priorGamesByTeam
                ),
                (completed, total) => {
                    if (generation !== state.generation) return;
                    setRunning(true, `Final試合を解析しています… ${completed}/${total}`);
                }
            );
            if (generation !== state.generation) return;
            const payload = {
                version: 1,
                date,
                checkedAt: nowIso(),
                totalGames: games.length,
                finalGames: finalGames.length,
                unfinishedGames: games.length - finalGames.length,
                games: games.map((game) => ({
                    gamePk: number(game.gamePk),
                    status: text(game?.status?.detailedState),
                    isFinal: isFinal(game)
                })),
                records: dedupeRecords(gameRecords.flat()).sort((left, right) =>
                    CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) ||
                    left.teamCode.localeCompare(right.teamCode, "en") ||
                    left.fact.localeCompare(right.fact, "ja")
                )
            };
            await window.MLBRecordsArchive?.absorb(payload.records);
            writeCache(payload);
            renderPayload(payload);
        } catch (error) {
            if (error?.name !== "AbortError" && generation === state.generation) {
                console.error("本日の記録を調査できませんでした。", error);
                renderError(error);
            }
        } finally {
            if (generation === state.generation) {
                state.controller = null;
                setRunning(false);
            }
        }
    };

    const setDate = async (date, { force = false } = {}) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text(date))) return;
        state.date = date;
        dom.date.value = date;
        window.MLBAppSession?.save?.({ view: "daily-records", date });
        await investigate({ force });
    };
    const close = ({ preserveShell = false } = {}) => {
        state.generation += 1;
        state.controller?.abort();
        state.controller = null;
        state.running = false;
        if (dom.page) dom.page.hidden = true;
        if (!preserveShell) document.body.classList.remove("app-mode-daily-records");
    };
    const open = async ({ date = "", force = false } = {}) => {
        if (!dom.page) initialize();
        dom.page.hidden = false;
        const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(text(date))
            ? date
            : currentSiteDate();
        await setDate(selectedDate, { force });
    };

    const initialize = () => {
        if (dom.page) return;
        dom.page = document.getElementById("daily-records-page");
        dom.date = document.getElementById("daily-records-date");
        dom.prev = document.getElementById("daily-records-prev");
        dom.today = document.getElementById("daily-records-today");
        dom.next = document.getElementById("daily-records-next");
        dom.refresh = document.getElementById("daily-records-refresh");
        dom.summary = document.getElementById("daily-records-summary");
        dom.progress = document.getElementById("daily-records-progress");
        dom.progressText = document.getElementById("daily-records-progress-text");
        dom.content = document.getElementById("daily-records-content");
        dom.modeToday = document.getElementById("daily-records-mode-today");
        dom.modeSearch = document.getElementById("daily-records-mode-search");
        dom.searchPanel = document.getElementById("daily-records-search-panel");
        dom.searchInput = document.getElementById("daily-records-search-input");
        dom.searchJapanese = document.getElementById("daily-records-search-japanese");
        dom.searchCategory = document.getElementById("daily-records-search-category");
        dom.searchSeason = document.getElementById("daily-records-search-season");
        dom.searchOrder = document.getElementById("daily-records-search-order");
        dom.archiveRange = document.getElementById("daily-records-archive-range");
        dom.archiveLoading = document.getElementById("daily-records-archive-loading");
        dom.archiveLoadingText = document.getElementById("daily-records-archive-loading-text");
        dom.searchSummary = document.getElementById("daily-records-search-summary");
        dom.searchResults = document.getElementById("daily-records-search-results");
        dom.date.addEventListener("change", () => setDate(dom.date.value));
        dom.prev.addEventListener("click", () => setDate(addDays(state.date, -1)));
        dom.today.addEventListener("click", () => setDate(currentSiteDate()));
        dom.next.addEventListener("click", () => setDate(addDays(state.date, 1)));
        dom.refresh.addEventListener("click", () => investigate({ force: true }));
        dom.modeToday.addEventListener("click", () => setMode("today"));
        dom.modeSearch.addEventListener("click", () => setMode("search"));
        [dom.searchInput, dom.searchJapanese, dom.searchCategory, dom.searchSeason, dom.searchOrder]
            .forEach((node) => node.addEventListener(node === dom.searchInput ? "input" : "change", () =>
                renderArchiveSearch()
            ));
    };

    window.DailyRecords = Object.freeze({
        open,
        close,
        thresholds: RECORD_THRESHOLDS,
        recordCatalog: RECORD_CATALOG,
        archiveBuilder: Object.freeze({
            analyzeGame,
            analyzeOneGame,
            fetchJapanesePlayers,
            japaneseCareerRecords
        })
    });

    if (typeof document === "undefined") return;
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
