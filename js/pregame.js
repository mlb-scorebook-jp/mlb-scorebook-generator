"use strict";

(() => {
    const API_ROOT = "https://statsapi.mlb.com/api";
    const cache = new Map();
    const gameIndex = new Map();
    let currentContext = null;
    let currentDate = "";

    const dom = {};

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

    const formatDate = (date) => {
        const [year, month, day] = String(date ?? "").slice(0, 10).split("-");
        return year && month && day ? `${year}/${Number(month)}/${Number(day)}` : String(date ?? "-");
    };

    const previousDate = (date) => {
        const value = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
        value.setUTCDate(value.getUTCDate() - 1);
        return value.toISOString().slice(0, 10);
    };

    const currentMlbDate = () => new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());

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

    const getSeasonJapanesePlayers = async (season) => {
        const payload = await fetchJson(
            `${API_ROOT}/v1/sports/1/players?season=${season}&hydrate=currentTeam`,
            `pregame:japanese:${season}`
        );
        return (payload?.people ?? []).filter((person) =>
            String(person?.birthCountry ?? person?.country ?? "").toLowerCase() === "japan" &&
            Number(person?.currentTeam?.id)
        );
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
            ? ["wins", "strikeOuts", "gamesPlayed", "saves"]
            : ["hits", "homeRuns", "rbi", "stolenBases"];
        const teamSplits = splits.filter((split) =>
            Number(split?.sport?.id) === 1 && Boolean(split?.team?.id)
        );
        if (!teamSplits.length) return null;
        return teamSplits.reduce((totals, split) => {
            additiveFields.forEach((field) => {
                totals[field] = (totals[field] ?? 0) + statNumber(split?.stat?.[field]);
            });
            return totals;
        }, {});
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
                try {
                    const parsed = new URL(supplied || `/news/${value.slug}`, "https://www.mlb.com");
                    if (parsed.protocol === "https:" &&
                        (parsed.hostname === "mlb.com" || parsed.hostname.endsWith(".mlb.com"))) {
                        url = parsed.href;
                    }
                } catch (_error) {
                    url = "";
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
                officialTransaction: true
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

    const statNumber = (value) => Number(value) || 0;

    const inningsToOuts = (value) => {
        const [whole, partial = "0"] = String(value ?? "0").split(".");
        return statNumber(whole) * 3 + Math.min(2, statNumber(partial));
    };

    const formatInnings = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

    const aggregateHitting = (splits) => {
        const totals = splits.reduce((sum, split) => {
            const stat = split?.stat ?? {};
            ["atBats", "hits", "homeRuns", "rbi", "stolenBases", "baseOnBalls", "hitByPitch", "sacFlies", "totalBases"]
                .forEach((field) => { sum[field] += statNumber(stat[field]); });
            return sum;
        }, { atBats: 0, hits: 0, homeRuns: 0, rbi: 0, stolenBases: 0, baseOnBalls: 0, hitByPitch: 0, sacFlies: 0, totalBases: 0 });
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
            ["earnedRuns", "strikeOuts", "baseOnBalls", "hits", "wins", "saves"]
                .forEach((field) => { sum[field] += statNumber(stat[field]); });
            return sum;
        }, { outs: 0, earnedRuns: 0, strikeOuts: 0, baseOnBalls: 0, hits: 0, wins: 0, saves: 0 });
        return {
            ...totals,
            innings: formatInnings(totals.outs),
            era: totals.outs ? totals.earnedRuns * 27 / totals.outs : 0
        };
    };

    const getHittingStreaks = (splits) => {
        const ordered = [...splits].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        let hits = 0;
        let onBase = 0;
        let rbi = 0;
        ordered.forEach((split) => {
            const stat = split?.stat ?? {};
            const pa = statNumber(stat.plateAppearances) ||
                statNumber(stat.atBats) + statNumber(stat.baseOnBalls) + statNumber(stat.hitByPitch);
            if (!pa) return;
            hits = statNumber(stat.hits) > 0 ? hits + 1 : 0;
            onBase = statNumber(stat.hits) + statNumber(stat.baseOnBalls) + statNumber(stat.hitByPitch) > 0
                ? onBase + 1 : 0;
            rbi = statNumber(stat.rbi) > 0 ? rbi + 1 : 0;
        });
        return { hits, onBase, rbi };
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

    const setLoading = (loading) => {
        dom.loading.hidden = !loading;
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
        dom.subtitle.textContent = `${teamCode(team)} / ${formatDate(date)} 試合前資料`;
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
            (record?.teamRecords ?? []).forEach((teamRecord) => {
                standings.set(Number(teamRecord?.team?.id), {
                    division: divisionJapaneseLabel(record?.division?.name ?? teamRecord?.team?.division?.name),
                    rank: Number.parseInt(teamRecord?.divisionRank, 10)
                });
            });
        });
        return standings;
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

    const setMatchupHeader = (awayTeam, homeTeam, standings, game, feed) => {
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
            block.append(
                teamName,
                el("small", "", `${standing?.division ?? "所属地区未確定"}　${rank}`)
            );
            return block;
        };
        dom.title.className = "pregame-matchup-heading";
        dom.title.parentElement?.classList.add("pregame-matchup-title-block");
        dom.title.replaceChildren(
            teamBlock(awayTeam),
            el("span", "pregame-header-versus", "VS."),
            teamBlock(homeTeam)
        );
        const venue = venueLabel(feed?.gameData?.venue ?? game?.venue) || "球場未定";
        const dateTime = feed?.gameData?.datetime?.dateTime ?? game?.gameDate;
        dom.subtitle.className = "pregame-matchup-meta-line";
        dom.subtitle.replaceChildren(
            el("span", "pregame-matchup-venue", venue),
            el("span", "pregame-matchup-times",
                `ET ${formatGameTime(dateTime, "America/New_York")}　｜　` +
                `JST ${formatGameTime(dateTime, "Asia/Tokyo")}`
            )
        );
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

    const renderArticles = (articles) => {
        const list = el("div", "pregame-article-list");
        if (!articles.length) return empty("該当するMLB公式記事はありません。");
        articles.slice(0, 8).forEach((article) => {
            const row = el("div", "pregame-article-row");
            const link = el("a", "", article.headline);
            link.href = article.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            row.append(link);
            list.append(row);
        });
        return list;
    };

    const renderTop = async () => {
        setLoading(true);
        const date = currentDate || currentMlbDate();
        if (dom.dateInput) dom.dateInput.value = date;
        setHeader("試合前情報", formatDate(date));
        try {
            const season = Number(date.slice(0, 4));
            const [games, japanesePlayers] = await Promise.all([
                getSchedule(date),
                getSeasonJapanesePlayers(season)
            ]);
            const teamGame = new Map();
            games.forEach((game) => {
                [game?.teams?.away?.team, game?.teams?.home?.team].forEach((team) => {
                    if (team?.id) teamGame.set(Number(team.id), game);
                });
            });
            const japaneseTeamIds = [...new Set(japanesePlayers
                .map((person) => Number(person?.currentTeam?.id))
                .filter((teamId) => teamGame.has(teamId)))];
            const rosterEntries = await Promise.all(japaneseTeamIds.map(async (teamId) => [
                teamId,
                await getActiveRosterIds(teamId, date)
            ]));
            const activeRosterByTeam = new Map(rosterEntries);
            const todaysJapanese = japanesePlayers
                .filter((person) => {
                    const teamId = Number(person?.currentTeam?.id);
                    return teamGame.has(teamId) && activeRosterByTeam.get(teamId)?.has(Number(person.id));
                })
                .sort((a, b) => playerName(a).localeCompare(playerName(b), "ja"));

            const dashboard = el("div", "pregame-dashboard");
            const japaneseSection = section(
                "日本人選手",
                `${todaysJapanese.length}人 / MLB公式登録`
            );
            const japaneseGrid = el("div", "pregame-card-grid");
            if (!todaysJapanese.length) {
                japaneseSection.append(empty("この日に試合がある日本人選手は見つかりませんでした。"));
            } else {
                todaysJapanese.forEach((person) => {
                    const game = teamGame.get(Number(person.currentTeam.id));
                    const officialTeam = [game?.teams?.away?.team, game?.teams?.home?.team]
                        .find((team) => Number(team?.id) === Number(person.currentTeam.id));
                    const card = el("button", "pregame-person-card");
                    card.type = "button";
                    card.dataset.pregamePlayer = String(person.id);
                    card.dataset.pregameGame = String(game.gamePk);
                    card.append(
                        el("strong", "", playerName(person)),
                        el("small", "", `${teamCode(officialTeam)} / ${positionLabel(person.primaryPosition?.abbreviation)}`),
                        el("span", isLive(game) ? "pregame-live-badge" : "pregame-status-badge", statusLabel(game))
                    );
                    japaneseGrid.append(card);
                });
                japaneseSection.append(japaneseGrid);
            }
            dashboard.append(japaneseSection);

            const gamesSection = section("全試合", `${games.length}試合`);
            const gamesGrid = el("div", "pregame-card-grid");
            if (!games.length) {
                gamesSection.append(empty("この日のMLB公式戦は見つかりませんでした。"));
            } else {
                games.forEach((game) => {
                    const away = game?.teams?.away?.team ?? {};
                    const home = game?.teams?.home?.team ?? {};
                    const card = el("button", "pregame-game-card");
                    const matchupTitle = el("strong", "pregame-matchup-title");
                    matchupTitle.append(
                        document.createTextNode(teamJapaneseShortName(away)),
                        el("span", "pregame-versus", "VS."),
                        document.createTextNode(teamJapaneseShortName(home))
                    );
                    const matchupMeta = el("small", "pregame-matchup-meta");
                    matchupMeta.append(
                        el("span", "pregame-venue-line", venueLabel(game?.venue) || "球場未定"),
                        el("span", "pregame-pitcher-line", `先発　${
                            game?.teams?.away?.probablePitcher?.fullName
                                ? playerName(game.teams.away.probablePitcher)
                                : "未定"
                        }　対　${
                            game?.teams?.home?.probablePitcher?.fullName
                                ? playerName(game.teams.home.probablePitcher)
                                : "未定"
                        }`)
                    );
                    card.type = "button";
                    card.dataset.pregameGame = String(game.gamePk);
                    card.append(
                        matchupTitle,
                        matchupMeta,
                        el("span", isLive(game) ? "pregame-live-badge" : "pregame-status-badge", statusLabel(game))
                    );
                    gamesGrid.append(card);
                });
                gamesSection.append(gamesGrid);
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

    const renderPlayerDetail = async (playerId, gamePk) => {
        setLoading(true);
        try {
            const game = gameIndex.get(Number(gamePk)) ?? currentContext?.scheduleGame ?? {};
            const date = String(game?.officialDate ?? currentDate);
            const season = Number(date.slice(0, 4));
            const [feed, articles] = await Promise.all([
                getFeed(gamePk),
                getGameArticles(gamePk)
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
            const careers = Object.fromEntries(await Promise.all(groups.map(async (group) => [
                group,
                await getPlayerCareer(person, group, date).catch(() => null)
            ])));
            const officialArticles = articles.filter((article) => articleHasPlayer(article, playerId));
            const gameInfo = getPlayerGameInfo(feed, game, playerId);

            const playerTeam = [feed?.gameData?.teams?.away, feed?.gameData?.teams?.home]
                .find((team) => Number(team?.id) === Number(person?.currentTeam?.id)) ??
                feed?.gameData?.teams?.[gameInfo?.side] ?? person?.currentTeam;
            setPlayerHeader(person, playerTeam, date);
            const grid = el("div", "pregame-detail-grid");

            groups.forEach((group) => {
                const recent = [...(logs[group] ?? [])].slice(-10);
                const five = recent.slice(-5);
                const statsSection = section(
                    group === "hitting" ? "最近の打撃成績" : "最近の投手成績",
                    "試合前時点"
                );
                statsSection.classList.add(groups.length > 1 ? "pregame-span-6" : "pregame-span-8");
                const metrics = el("div", "pregame-metric-grid");
                if (group === "hitting") {
                    const fiveStats = aggregateHitting(five);
                    const tenStats = aggregateHitting(recent);
                    metrics.append(
                        metric("直近5試合 打率", fiveStats.avg.toFixed(3).replace(/^0/, "")),
                        metric("直近5試合 OPS", fiveStats.ops.toFixed(3).replace(/^0/, "")),
                        metric("直近10試合 打率", tenStats.avg.toFixed(3).replace(/^0/, "")),
                        metric("直近10試合 OPS", tenStats.ops.toFixed(3).replace(/^0/, "")),
                        metric("10試合 本塁打", String(tenStats.homeRuns)),
                        metric("10試合 打点", String(tenStats.rbi)),
                        metric("10試合 盗塁", String(tenStats.stolenBases))
                    );
                } else {
                    const fiveStats = aggregatePitching(five);
                    const tenStats = aggregatePitching(recent);
                    metrics.append(
                        metric("直近5登板 防御率", fiveStats.era.toFixed(2)),
                        metric("直近5登板 投球回", fiveStats.innings),
                        metric("直近5登板 奪三振", String(fiveStats.strikeOuts)),
                        metric("直近10登板 防御率", tenStats.era.toFixed(2)),
                        metric("直近10登板 奪三振", String(tenStats.strikeOuts)),
                        metric("直近10登板 四球", String(tenStats.baseOnBalls))
                    );
                }
                statsSection.append(metrics);
                grid.append(statsSection);
            });

            const currentSection = section("現在継続中の記録", "放送用メモ");
            currentSection.classList.add("pregame-span-4");
            const currentList = el("ul", "pregame-data-list");
            const notes = [];
            if (logs.hitting) {
                const streaks = getHittingStreaks(logs.hitting);
                if (streaks.hits >= 2) notes.push(`${streaks.hits}試合連続安打`);
                if (streaks.onBase >= 2) notes.push(`${streaks.onBase}試合連続出塁`);
                if (streaks.rbi >= 2) notes.push(`${streaks.rbi}試合連続打点`);
            }
            groups.forEach((group) => notes.push(...remainingMilestones(careers[group], group)));
            (notes.length ? notes : ["現在表示対象となる継続・節目記録はありません。"])
                .forEach((text) => currentList.append(el("li", "", text)));
            currentSection.append(currentList);
            grid.append(currentSection);

            const todaySection = section("今日の情報", statusLabel(game));
            todaySection.classList.add("pregame-span-6");
            const todayList = el("ul", "pregame-data-list");
            const todayLines = [];
            if (gameInfo?.battingOrder) {
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

            dom.content.replaceChildren(grid);
        } catch (error) {
            console.error(error);
            dom.content.replaceChildren(el("div", "pregame-error", error.message));
        } finally {
            setLoading(false);
        }
    };

    const getTeamSchedule = async (teamId, date) => {
        const season = date.slice(0, 4);
        const params = new URLSearchParams({
            sportId: "1",
            teamId: String(teamId),
            startDate: `${season}-02-01`,
            endDate: date,
            gameType: "R"
        });
        const payload = await fetchJson(
            `${API_ROOT}/v1/schedule?${params}`,
            `pregame:team-schedule:${teamId}:${date}`
        );
        return (payload?.dates ?? []).flatMap((entry) => entry.games ?? [])
            .filter(isFinal);
    };

    const getTeamTrend = async (teamId, date) => {
        const schedule = await getTeamSchedule(teamId, date);
        const recent = schedule.slice(-10);
        const outcomes = recent.map((game) => {
            const away = game?.teams?.away ?? {};
            const home = game?.teams?.home ?? {};
            const own = Number(away?.team?.id) === Number(teamId) ? away : home;
            const opponent = own === away ? home : away;
            return statNumber(own.score) > statNumber(opponent.score) ? "W" : "L";
        });
        const latest = outcomes.at(-1);
        let streak = 0;
        for (let index = outcomes.length - 1; index >= 0 && outcomes[index] === latest; index -= 1) {
            streak += 1;
        }
        const startDate = recent[0]?.officialDate ?? date;
        const [hittingPayload, pitchingPayload] = await Promise.all([
            fetchJson(
                `${API_ROOT}/v1/teams/${teamId}/stats?stats=byDateRange&group=hitting&gameType=R&startDate=${startDate}&endDate=${date}`,
                `pregame:team-hit:${teamId}:${startDate}:${date}`
            ).catch(() => null),
            fetchJson(
                `${API_ROOT}/v1/teams/${teamId}/stats?stats=byDateRange&group=pitching&gameType=R&startDate=${startDate}&endDate=${date}`,
                `pregame:team-pitch:${teamId}:${startDate}:${date}`
            ).catch(() => null)
        ]);
        const hitting = hittingPayload?.stats?.[0]?.splits?.[0]?.stat ?? {};
        const pitching = pitchingPayload?.stats?.[0]?.splits?.[0]?.stat ?? {};
        return {
            wins: outcomes.filter((value) => value === "W").length,
            losses: outcomes.filter((value) => value === "L").length,
            streakText: streak >= 2 ? `${streak}連${latest === "W" ? "勝" : "敗"}` : "-",
            avg: hitting.avg ?? "-",
            ops: hitting.ops ?? "-",
            era: pitching.era ?? "-"
        };
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
                rosterPosition: rosterEntry?.position?.abbreviation
            };
        });
    };

    const getFeaturedPlayerData = async (entry, date) => {
        const playerId = Number(entry?.person?.id);
        const season = Number(date.slice(0, 4));
        if (!playerId) return { entry, notes: [], importance: 0 };
        const profile = await fetchJson(
            `${API_ROOT}/v1/people/${playerId}`,
            `pregame:featured-profile:${playerId}`
        ).then((payload) => payload?.people?.[0] ?? entry.person).catch(() => entry.person);
        const primaryType = String(profile?.primaryPosition?.type ?? "").toLowerCase();
        const primaryAbbreviation = String(profile?.primaryPosition?.abbreviation ?? "").toUpperCase();
        const isTwoWay = primaryType.includes("two-way") || primaryAbbreviation === "TWP";
        const isPitcher = primaryType === "pitcher" || primaryAbbreviation === "P";
        const groups = isTwoWay ? ["hitting", "pitching"] : [isPitcher ? "pitching" : "hitting"];
        const [hittingLogs, ...careers] = await Promise.all([
            groups.includes("hitting")
                ? getPlayerGameLog(playerId, season, "hitting").catch(() => [])
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
        const streaks = getHittingStreaks(priorHittingLogs);
        const hittingGameLogUrl = officialPlayerStatsUrl("hitting", "gamelogs");
        if (streaks.hits >= 3) notes.push({ text: `${streaks.hits}試合連続安打`, href: hittingGameLogUrl });
        if (streaks.onBase >= 5) notes.push({ text: `${streaks.onBase}試合連続出塁`, href: hittingGameLogUrl });
        if (streaks.rbi >= 3) notes.push({ text: `${streaks.rbi}試合連続打点`, href: hittingGameLogUrl });
        importance += streaks.hits >= 3 ? streaks.hits : 0;
        importance += streaks.onBase >= 5 ? streaks.onBase : 0;
        groups.forEach((group, index) => {
            const milestoneNotes = remainingMilestones(careers[index], group);
            notes.push(...milestoneNotes.map((text) => ({
                text,
                href: officialPlayerStatsUrl(group, "career")
            })));
            importance += milestoneNotes.length * 10;
        });
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
        featured.notes.slice(0, 3).forEach((note) => {
            const noteLink = el("a", "pregame-featured-note", note.text);
            noteLink.href = note.href;
            noteLink.target = "_blank";
            noteLink.rel = "noopener noreferrer";
            noteLink.setAttribute("aria-label", `${playerName(entry?.person)}：${note.text}のMLB公式情報を開く`);
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
        const previousAppearance = careerLogs
            .filter((split) => String(split?.date ?? "") < date && statNumber(split?.stat?.gamesPlayed) > 0)
            .sort((a, b) => String(b?.date ?? "").localeCompare(String(a?.date ?? "")))[0];
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
            previousAppearance,
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
        const starts = statNumber(data.seasonStats?.gamesStarted);
        const seasonGrid = el("div", "pregame-starting-stats");
        seasonGrid.textContent = `${starts}試合（${starts}先発）　` +
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
        const previousEntry = data.previousAppearance;
        const previous = previousEntry?.stat;
        const previousBox = el("div", "pregame-previous-start");
        if (previous) {
            const walksAndHitByPitch = statNumber(previous.baseOnBalls) + statNumber(previous.hitBatsmen);
            const decision = pitcherDecision(previous);
            previousBox.append(
                el("strong", "", "前回登板"),
                el("span", "pregame-previous-meta",
                    `${compactDate(previousEntry?.date)}　vs. ${teamCode(previousEntry?.opponent)}` +
                    (decision ? `　${decision}` : "")
                ),
                el("span", "pregame-previous-line",
                    `${previous.inningsPitched ?? "-"}回　${statNumber(previous.runs)}失点　` +
                    `${statNumber(previous.strikeOuts)}奪三振　${walksAndHitByPitch}四死球`
                )
            );
        } else {
            previousBox.append(el("strong", "", data.hasCareerAppearance ? "今季初登板" : "MLB初登板"));
        }
        column.append(previousBox);
        return column;
    };

    const renderGameDetail = async (gamePk) => {
        setLoading(true);
        try {
            const game = gameIndex.get(Number(gamePk)) ?? currentContext?.scheduleGame ?? {};
            const [feed, articles] = await Promise.all([getFeed(gamePk), getGameArticles(gamePk)]);
            const date = String(feed?.gameData?.datetime?.officialDate ?? game?.officialDate ?? currentDate);
            const awayTeam = feed?.gameData?.teams?.away ?? game?.teams?.away?.team ?? {};
            const homeTeam = feed?.gameData?.teams?.home ?? game?.teams?.home?.team ?? {};
            const [awayTrend, homeTrend, standings, transactions, injuries] = await Promise.all([
                getTeamTrend(awayTeam.id, date),
                getTeamTrend(homeTeam.id, date),
                getStandingsSnapshot(date),
                getRecentTeamTransactions([awayTeam, homeTeam], date),
                getTeamInjuryReports([awayTeam, homeTeam], date)
            ]);
            setMatchupHeader(awayTeam, homeTeam, standings, game, feed);
            const grid = el("div", "pregame-detail-grid");

            const awayProbable = getProbablePitcher(game, feed, "away");
            const homeProbable = getProbablePitcher(game, feed, "home");
            const [awayStarter, homeStarter] = await Promise.all([
                getStartingPitcherData(awayProbable, date, homeTeam),
                getStartingPitcherData(homeProbable, date, awayTeam)
            ]);
            const startingSection = section("Starting Pitcher", "先発投手比較");
            startingSection.classList.add("pregame-span-12");
            const startingGrid = el("div", "pregame-starting-grid");
            startingGrid.append(
                renderStartingPitcher(awayStarter, awayTeam),
                renderStartingPitcher(homeStarter, homeTeam)
            );
            startingSection.append(startingGrid);
            grid.append(startingSection);

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
                const starters = await getFeaturedPlayers(feed, side, date);
                const featured = (await Promise.all(
                    starters.map((entry) => getFeaturedPlayerData(entry, date))
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

            const trendsSection = section("チーム動向", "直近10試合");
            trendsSection.classList.add("pregame-team-trends-section");
            const trendColumns = el("div", "pregame-team-columns");
            [[awayTeam, awayTrend], [homeTeam, homeTrend]].forEach(([team, trend]) => {
                const column = el("div");
                column.append(el("h4", "pregame-team-heading", teamCode(team)));
                const metrics = el("div", "pregame-metric-grid");
                const season = Number(date.slice(0, 4));
                const battingUrl = getOfficialTeamStatsUrl(team, season, "hitting");
                const pitchingUrl = getOfficialTeamStatsUrl(team, season, "pitching");
                metrics.append(
                    metric("直近10試合", `${trend.wins}勝${trend.losses}敗`),
                    metric("連勝・連敗", trend.streakText),
                    metric("チーム打率", String(trend.avg), battingUrl ? {
                        href: battingUrl,
                        ariaLabel: `${teamCode(team)}の${season}年MLB公式チーム打撃成績を新しいタブで開く`
                    } : null),
                    metric("チームOPS", String(trend.ops)),
                    metric("投手ERA", String(trend.era), pitchingUrl ? {
                        href: pitchingUrl,
                        ariaLabel: `${teamCode(team)}の${season}年MLB公式チーム投手成績を新しいタブで開く`
                    } : null)
                );
                column.append(metrics);
                trendColumns.append(column);
            });
            trendsSection.append(trendColumns);

            const articleSection = section("MLB公式関連記事", "プレビュー・怪我・ロースター・トレード");
            articleSection.append(renderArticles([...injuries, ...transactions, ...articles]));

            const lowerLayout = el("div", "pregame-lower-layout pregame-span-12");
            const rightColumn = el("div", "pregame-lower-right");
            rightColumn.append(trendsSection, articleSection);
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
        currentContext = context;
        currentDate = String(
            context?.gameData?.gameData?.datetime?.officialDate ??
            document.getElementById("header-game-date")?.value?.split("|")?.[0] ??
            currentMlbDate()
        ).slice(0, 10);
        dom.viewer.classList.add("pregame-active");
        dom.view.hidden = false;
        await renderTop();
    };

    const close = () => {
        dom.viewer.classList.remove("pregame-active");
        dom.view.hidden = true;
    };

    const initialize = () => {
        dom.viewer = document.querySelector(".viewer");
        dom.view = document.getElementById("pregame-view");
        dom.content = document.getElementById("pregame-content");
        dom.loading = document.getElementById("pregame-loading");
        dom.title = document.getElementById("pregame-title");
        dom.subtitle = document.getElementById("pregame-subtitle");
        dom.dateInput = document.getElementById("pregame-date");
        dom.homeButton = document.getElementById("pregame-home-btn");
        dom.closeButton = document.getElementById("pregame-close-btn");
        if (!dom.view) return;
        dom.dateInput.addEventListener("change", async () => {
            const selectedDate = String(dom.dateInput.value ?? "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return;
            currentDate = selectedDate;
            await renderTop();
        });
        dom.homeButton.addEventListener("click", renderTop);
        dom.closeButton.addEventListener("click", close);
        dom.content.addEventListener("click", (event) => {
            const playerCard = event.target.closest("[data-pregame-player]");
            if (playerCard) {
                renderPlayerDetail(
                    Number(playerCard.dataset.pregamePlayer),
                    Number(playerCard.dataset.pregameGame)
                );
                return;
            }
            const gameCard = event.target.closest("[data-pregame-game]");
            if (gameCard) renderGameDetail(Number(gameCard.dataset.pregameGame));
        });
    };

    window.PregameInfo = { open, close, renderTop, renderGameDetail, renderPlayerDetail };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
