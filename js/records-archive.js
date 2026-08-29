"use strict";

(() => {
    const INDEX_URL = "data/records/index.json";
    const COVERAGE_URL = "data/records/coverage.json";
    const LOCAL_KEY = "mlb-records-archive-overlay-v1";
    const TEAM_SLUG_BY_ID = Object.freeze({
        108: "angels", 109: "d-backs", 110: "orioles", 111: "red-sox", 112: "cubs",
        113: "reds", 114: "guardians", 115: "rockies", 116: "tigers", 117: "astros",
        118: "royals", 119: "dodgers", 120: "nationals", 121: "mets", 133: "athletics",
        134: "pirates", 135: "padres", 136: "mariners", 137: "giants", 138: "cardinals",
        139: "rays", 140: "rangers", 141: "blue-jays", 142: "twins", 143: "phillies",
        144: "braves", 145: "white-sox", 146: "marlins", 147: "yankees", 158: "brewers"
    });
    const FULL_TEAM_SLUGS = Object.freeze({
        "los-angeles-angels": "angels", "arizona-diamondbacks": "d-backs",
        "baltimore-orioles": "orioles", "boston-red-sox": "red-sox",
        "chicago-cubs": "cubs", "cincinnati-reds": "reds",
        "cleveland-guardians": "guardians", "colorado-rockies": "rockies",
        "detroit-tigers": "tigers", "houston-astros": "astros",
        "kansas-city-royals": "royals", "los-angeles-dodgers": "dodgers",
        "washington-nationals": "nationals", "new-york-mets": "mets",
        "athletics": "athletics", "pittsburgh-pirates": "pirates",
        "san-diego-padres": "padres", "seattle-mariners": "mariners",
        "san-francisco-giants": "giants", "st-louis-cardinals": "cardinals",
        "tampa-bay-rays": "rays", "texas-rangers": "rangers",
        "toronto-blue-jays": "blue-jays", "minnesota-twins": "twins",
        "philadelphia-phillies": "phillies", "atlanta-braves": "braves",
        "chicago-white-sox": "white-sox", "miami-marlins": "marlins",
        "new-york-yankees": "yankees", "milwaukee-brewers": "brewers"
    });
    let loaded = false;
    let loadPromise = null;
    let metadata = { startDate: "2026-01-01", years: [2026] };
    let coverage = { records: {} };
    let records = [];
    let sharedArchiveKeys = new Set();
    let recordPresence = new Set();
    let supersededArchiveKeys = new Set();
    const LOAD_BATCH_SIZE = 3;
    const PLAYER_PRESENCE_TYPES = new Set([
        "FOUR_HR_GAME", "SEVEN_HIT_GAME", "FIVE_SB_GAME",
        "NO_WALK_SHUTOUT", "MADDUX", "PERFECT_GAME",
        "PINCH_HIT_GRAND_SLAM", "PINCH_HIT_WALKOFF_HOME_RUN",
        "PINCH_HIT_WALKOFF_GRAND_SLAM", "WALKOFF_GRAND_SLAM"
    ]);
    const TEAM_PRESENCE_TYPES = new Set(["NO_HIT_WIN"]);
    const INNING_PRESENCE_TYPES = new Set(["TEN_RUN_INNING"]);
    const GAME_PRESENCE_TYPES = new Set(["TEN_COMBINED_HR"]);

    const text = (value) => String(value ?? "").trim();
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const normalizeSearch = (value) => text(value).normalize("NFKC").toLowerCase()
        .replace(/[・･·._\-‐‑‒–—―ー@＠/\\()（）\[\]【】「」『』,，.。:：;；'\"“”‘’]/g, "")
        .replace(/\s+/g, "");
    const queryTerms = (value) => text(value).normalize("NFKC").split(/\s+/)
        .map(normalizeSearch).filter(Boolean);
    const EXACT_ALIAS_TERMS = new Set(["ph"]);
    const archiveKey = (record) => [
        text(record.recordType),
        number(record.gamePk),
        number(record.playerId) || `team-${number(record.teamId)}`,
        number(record.inning) || 0,
        text(record.details?.metric || "")
    ].join(":");
    const orderValue = (record) => [
        text(record.date),
        text(record.gameDate || ""),
        String(number(record.gamePk)).padStart(9, "0")
    ].join("|");
    const gamedayUrlForGame = (game) => {
        const away = game?.teams?.away?.team ?? {};
        const home = game?.teams?.home?.team ?? {};
        const awaySlug = TEAM_SLUG_BY_ID[number(away.id)];
        const homeSlug = TEAM_SLUG_BY_ID[number(home.id)];
        const date = text(game?.officialDate).replaceAll("-", "/");
        if (!awaySlug || !homeSlug || !date || !number(game?.gamePk)) return "";
        return `https://www.mlb.com/gameday/${awaySlug}-vs-${homeSlug}/${date}/${number(game.gamePk)}/final`;
    };
    const repairGamedayUrl = (value) => {
        let url = text(value);
        Object.entries(FULL_TEAM_SLUGS).forEach(([full, club]) => {
            url = url.replace(`/gameday/${full}-vs-`, `/gameday/${club}-vs-`)
                .replace(`-vs-${full}/`, `-vs-${club}/`);
        });
        return url.replace(/\/(\d{4})-(\d{2})-(\d{2})\//, "/$1/$2/$3/");
    };
    const normalizeRecord = (record) => ({
        ...record,
        archiveKey: archiveKey(record),
        archiveOrderValue: orderValue(record),
        description: text(record.description || record.fact),
        isJapanesePlayer: record.isJapanesePlayer === true || record.category === "japanese",
        apiConfirmed: record.apiConfirmed !== false && record.apiStatus !== "unconfirmed",
        gamedayUrl: repairGamedayUrl(record.gamedayUrl),
        historicalContext: record.historicalContext ?? { status: "needs-review", text: "", sources: [] }
    });
    const merge = (...groups) => {
        const values = new Map();
        groups.flat().filter(Boolean).forEach((record) => {
            const normalized = normalizeRecord(record);
            values.set(normalized.archiveKey, { ...values.get(normalized.archiveKey), ...normalized });
        });
        return [...values.values()];
    };
    const readLocal = () => {
        try {
            const value = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
            return Array.isArray(value) ? value : [];
        } catch (_error) {
            return [];
        }
    };
    const readDailyRecordCaches = () => {
        const cached = [];
        try {
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index) || "";
                if (!key.startsWith("mlb-daily-records-phase1-v")) continue;
                const payload = JSON.parse(localStorage.getItem(key) || "null");
                if (Array.isArray(payload?.records)) cached.push(...payload.records);
            }
        } catch (_error) {
            return cached;
        }
        return cached;
    };
    const writeLocal = (values) => {
        try {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(values));
        } catch (error) {
            console.warn("記録アーカイブのローカル差分を保存できませんでした。", error);
        }
    };
    const fetchJson = async (url) => {
        let lastError;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const response = await fetch(url, { cache: "no-store" });
                if (!response.ok) throw new Error(String(response.status));
                return response.json();
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    };
    const archiveSources = () => {
        if (Array.isArray(metadata.archives)) return metadata.archives
            .map((entry) => ({ year: number(entry?.year), path: text(entry?.path) }))
            .filter((entry) => entry.year && entry.path);
        return (Array.isArray(metadata.years) ? metadata.years : [])
            .map((year) => ({ year: number(year), path: `${number(year)}.json` }));
    };
    const loadYearlyArchives = async () => {
        const sources = archiveSources();
        const yearly = [];
        const seenKeys = new Set();
        for (let start = 0; start < sources.length; start += LOAD_BATCH_SIZE) {
            const batch = sources.slice(start, start + LOAD_BATCH_SIZE);
            const batchRecords = (await Promise.all(batch.map(({ path }) =>
                fetchJson(`data/records/${path}`).catch(() => [])
            ))).flat();
            batchRecords.forEach((record) => {
                const normalized = normalizeRecord(record);
                if (seenKeys.has(normalized.archiveKey)) return;
                seenKeys.add(normalized.archiveKey);
                yearly.push(normalized);
            });
        }
        return yearly;
    };

    const playerPresenceKey = (recordType, record) => number(record?.playerId)
        ? `player:${recordType}:${number(record.gamePk)}:${number(record.playerId)}`
        : "";
    const teamPresenceKey = (recordType, record) =>
        `team:${recordType}:${number(record.gamePk)}:${number(record.teamId)}`;
    const inningPresenceKey = (recordType, record) =>
        `inning:${recordType}:${number(record.gamePk)}:${number(record.teamId)}:${number(record.inning)}`;
    const gamePresenceKey = (recordType, record) => `game:${recordType}:${number(record.gamePk)}`;
    const hasPresence = (scope, recordType, record) => {
        const key = scope === "player" ? playerPresenceKey(recordType, record)
            : scope === "team" ? teamPresenceKey(recordType, record)
                : scope === "inning" ? inningPresenceKey(recordType, record)
                    : gamePresenceKey(recordType, record);
        return Boolean(key) && recordPresence.has(key);
    };
    const rebuildRecordIndexes = () => {
        recordPresence = new Set();
        records.forEach((record) => {
            if (PLAYER_PRESENCE_TYPES.has(record.recordType)) {
                const playerKey = playerPresenceKey(record.recordType, record);
                if (playerKey) recordPresence.add(playerKey);
            }
            if (TEAM_PRESENCE_TYPES.has(record.recordType)) {
                recordPresence.add(teamPresenceKey(record.recordType, record));
            }
            if (INNING_PRESENCE_TYPES.has(record.recordType)) {
                recordPresence.add(inningPresenceKey(record.recordType, record));
            }
            if (GAME_PRESENCE_TYPES.has(record.recordType)) {
                recordPresence.add(gamePresenceKey(record.recordType, record));
            }
        });
        supersededArchiveKeys = new Set(records
            .filter((record) => superseded(record))
            .map((record) => record.archiveKey));
    };
    const load = async () => {
        if (loaded) return records;
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            let shared = [];
            try {
                [metadata, coverage] = await Promise.all([
                    fetchJson(INDEX_URL),
                    fetchJson(COVERAGE_URL).catch(() => ({ records: {} }))
                ]);
                shared = await loadYearlyArchives();
            } catch (_error) {
                // file:// preview may not allow JSON fetch; the local overlay remains usable.
            }
            const cachedDailyRecords = readDailyRecordCaches();
            sharedArchiveKeys = new Set(shared.map((record) => record.archiveKey));
            records = shared;
            const recordIndex = new Map(records.map((record, index) => [record.archiveKey, index]));
            merge(readLocal(), cachedDailyRecords).forEach((record) => {
                const existingIndex = recordIndex.get(record.archiveKey);
                if (existingIndex === undefined) {
                    recordIndex.set(record.archiveKey, records.length);
                    records.push(record);
                } else {
                    records[existingIndex] = { ...records[existingIndex], ...record };
                }
            });
            records.sort((left, right) =>
                right.archiveOrderValue.localeCompare(left.archiveOrderValue));
            rebuildRecordIndexes();
            if (cachedDailyRecords.length) {
                writeLocal(merge(readLocal(), cachedDailyRecords)
                    .filter((record) => !sharedArchiveKeys.has(record.archiveKey)));
            }
            loaded = true;
            return records;
        })();
        return loadPromise;
    };
    const absorb = async (newRecords) => {
        await load();
        const normalized = (newRecords ?? []).map(normalizeRecord);
        records = merge(records, normalized);
        records.sort((left, right) =>
            right.archiveOrderValue.localeCompare(left.archiveOrderValue));
        rebuildRecordIndexes();
        // Persist only the overlay. Static yearly JSON remains the cross-device source of truth.
        const overlay = merge(readLocal(), normalized)
            .filter((record) => !sharedArchiveKeys.has(record.archiveKey));
        writeLocal(overlay);
        return records;
    };
    const searchableText = (record) => normalizeSearch([
        record.recordType,
        ...(record.aliases ?? []),
        record.playerName,
        record.teamCode,
        record.teamName,
        record.opponentCode,
        record.opponentName,
        record.description,
        record.fact,
        record.date,
        text(record.date).replaceAll("-", "/"),
        record.season,
        record.isJapanesePlayer ? "日本人" : ""
    ].join(" "));
    const superseded = (record) => {
        const upper = {
            THREE_HR_GAME: ["FOUR_HR_GAME"], FIVE_HIT_GAME: ["SEVEN_HIT_GAME"],
            SIX_HIT_GAME: ["SEVEN_HIT_GAME"], FOUR_SB_GAME: ["FIVE_SB_GAME"]
        }[record.recordType];
        if (upper?.some((type) => hasPresence("player", type, record))) return true;
        if (record.recordType === "LOW_HIT_WIN" && hasPresence("team", "NO_HIT_WIN", record)) return true;
        if (record.recordType === "LARGE_RUN_INNING" && hasPresence("inning", "TEN_RUN_INNING", record)) return true;
        if (record.recordType === "COMBINED_LARGE_HR" && hasPresence("game", "TEN_COMBINED_HR", record)) return true;
        if (record.recordType === "SHUTOUT" && ["NO_WALK_SHUTOUT", "MADDUX"]
            .some((type) => hasPresence("player", type, record))) return true;
        const moreSpecific = {
            PINCH_HIT_HOME_RUN: ["PINCH_HIT_GRAND_SLAM", "PINCH_HIT_WALKOFF_HOME_RUN", "PINCH_HIT_WALKOFF_GRAND_SLAM"],
            PINCH_HIT_GRAND_SLAM: ["PINCH_HIT_WALKOFF_GRAND_SLAM"],
            PINCH_HIT_WALKOFF_HOME_RUN: ["PINCH_HIT_WALKOFF_GRAND_SLAM"],
            WALKOFF_HOME_RUN: ["PINCH_HIT_WALKOFF_HOME_RUN", "PINCH_HIT_WALKOFF_GRAND_SLAM", "WALKOFF_GRAND_SLAM"],
            WALKOFF_GRAND_SLAM: ["PINCH_HIT_WALKOFF_GRAND_SLAM"],
            SOLO_NO_HITTER: ["PERFECT_GAME"]
        }[record.recordType];
        if (moreSpecific?.some((type) => hasPresence("player", type, record))) return true;
        return false;
    };
    const search = ({ query = "", category = "all", season = "all", japaneseOnly = false,
        order = "newest", recordType = "" } = {}) => {
        const terms = queryTerms(query);
        const filtered = records.filter((record) => {
            if (supersededArchiveKeys.has(record.archiveKey)) return false;
            if (recordType && record.recordType !== recordType) return false;
            if (japaneseOnly && !record.isJapanesePlayer) return false;
            if (category !== "all" && record.category !== category) return false;
            if (season !== "all" && number(record.season) !== number(season)) return false;
            if (!terms.length) return true;
            const haystack = searchableText(record);
            return terms.every((term) => EXACT_ALIAS_TERMS.has(term)
                ? (record.aliases ?? []).some((alias) => normalizeSearch(alias) === term)
                : haystack.includes(term));
        });
        return order === "oldest" ? filtered.reverse() : filtered;
    };
    const previous = (target, scope = "type") => {
        if (scope === "player" && !number(target?.playerId)) return null;
        if (scope === "team" && !number(target?.teamId)) return null;
        const before = orderValue(target);
        return records.filter((record) => {
            if (record.archiveKey === archiveKey(target) || orderValue(record) >= before) return false;
            if (record.recordType !== target.recordType) return false;
            if (scope === "player" && number(record.playerId) !== number(target.playerId)) return false;
            if (scope === "team" && number(record.teamId) !== number(target.teamId)) return false;
            return true;
        }).sort((a, b) => orderValue(b).localeCompare(orderValue(a)))[0] ?? null;
    };
    const rangeLabel = () => {
        let start = "";
        records.forEach((record) => {
            const date = text(record.date);
            if (date && (!start || date < start)) start = date;
        });
        start = start || text(metadata.startDate) || "2026-01-01";
        return `${start.slice(0, 4)}年〜`;
    };
    const coverageFor = (recordType) => coverage?.records?.[recordType]?.coverage ?? null;
    const buildArchiveForDateRange = async (startDate, endDate, analyzeDate) => {
        if (typeof analyzeDate !== "function") throw new TypeError("日付解析関数が必要です。");
        const cursor = new Date(`${startDate}T12:00:00Z`);
        const end = new Date(`${endDate}T12:00:00Z`);
        while (cursor <= end) {
            const date = cursor.toISOString().slice(0, 10);
            await absorb(await analyzeDate(date));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return records;
    };

    window.MLBRecordsArchive = Object.freeze({
        load, absorb, search, previous, rangeLabel, archiveKey, normalizeSearch,
        buildArchiveForDateRange, gamedayUrlForGame, repairGamedayUrl,
        coverageFor,
        getMetadata: () => ({ ...metadata }),
        getSeasons: () => [...new Set(records.map((record) => number(record.season)).filter(Boolean))]
            .sort((left, right) => right - left),
        getAll: () => [...records]
    });
})();
