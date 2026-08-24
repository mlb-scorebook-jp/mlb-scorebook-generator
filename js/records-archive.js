"use strict";

(() => {
    const INDEX_URL = "data/records/index.json";
    const LOCAL_KEY = "mlb-records-archive-overlay-v1";
    let loaded = false;
    let loadPromise = null;
    let metadata = { startDate: "2026-01-01", years: [2026] };
    let records = [];
    let sharedArchiveKeys = new Set();

    const text = (value) => String(value ?? "").trim();
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const normalizeSearch = (value) => text(value).normalize("NFKC").toLowerCase()
        .replace(/[・･·._\-‐‑‒–—―ー@＠/\\()（）\[\]【】「」『』,，.。:：;；'\"“”‘’]/g, "")
        .replace(/\s+/g, "");
    const queryTerms = (value) => text(value).normalize("NFKC").split(/\s+/)
        .map(normalizeSearch).filter(Boolean);
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
    const normalizeRecord = (record) => ({
        ...record,
        archiveKey: archiveKey(record),
        description: text(record.description || record.fact),
        isJapanesePlayer: record.isJapanesePlayer === true || record.category === "japanese",
        apiConfirmed: record.apiConfirmed !== false && record.apiStatus !== "unconfirmed",
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
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
    };
    const load = async () => {
        if (loaded) return records;
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            let shared = [];
            try {
                metadata = await fetchJson(INDEX_URL);
                const years = Array.isArray(metadata.years) ? metadata.years : [];
                const yearly = await Promise.all(years.map((year) =>
                    fetchJson(`data/records/${year}.json`).catch(() => [])
                ));
                shared = yearly.flat();
            } catch (_error) {
                // file:// preview may not allow JSON fetch; the local overlay remains usable.
            }
            const cachedDailyRecords = readDailyRecordCaches();
            sharedArchiveKeys = new Set(shared.map((record) => archiveKey(record)));
            records = merge(shared, readLocal(), cachedDailyRecords);
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
        record.season,
        record.isJapanesePlayer ? "日本人" : ""
    ].join(" "));
    const search = ({ query = "", category = "all", season = "all", japaneseOnly = false,
        order = "newest", recordType = "" } = {}) => {
        const terms = queryTerms(query);
        const filtered = records.filter((record) => {
            if (recordType && record.recordType !== recordType) return false;
            if (japaneseOnly && !record.isJapanesePlayer) return false;
            if (category !== "all" && record.category !== category) return false;
            if (season !== "all" && number(record.season) !== number(season)) return false;
            const haystack = searchableText(record);
            return terms.every((term) => haystack.includes(term));
        });
        return filtered.sort((left, right) => order === "oldest"
            ? orderValue(left).localeCompare(orderValue(right))
            : orderValue(right).localeCompare(orderValue(left)));
    };
    const previous = (target, scope = "type") => {
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
        const dates = records.map((record) => text(record.date)).filter(Boolean).sort();
        const start = dates[0] || text(metadata.startDate) || "2026-01-01";
        return `${start.slice(0, 4)}年〜`;
    };
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
        buildArchiveForDateRange,
        getAll: () => [...records]
    });
})();
