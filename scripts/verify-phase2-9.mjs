#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORDS = path.join(ROOT, "data", "records");
const nodeFetch = globalThis.fetch;
globalThis.window = globalThis;
const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; }
};
globalThis.fetch = async (url, init) => {
    const value = String(url);
    if (/^https?:/.test(value)) return nodeFetch(value, init);
    try {
        const body = await fs.readFile(path.join(ROOT, value));
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    } catch (_error) {
        return new Response("", { status: 404 });
    }
};

const playerNamesSource = (await fs.readFile(path.join(ROOT, "js", "players.js"), "utf8"))
    .replace(/^const NHK_PLAYER_NAMES\s*=/, "globalThis.NHK_PLAYER_NAMES =");
vm.runInThisContext(playerNamesSource, { filename: "js/players.js" });
await import(path.join(ROOT, "js", "players-2026-updates.js"));
await import(path.join(ROOT, "js", "japanese-players.js"));
await import(path.join(ROOT, "js", "records-archive.js"));
await import(path.join(ROOT, "js", "daily-records.js"));

const started = performance.now();
const all = await globalThis.MLBRecordsArchive.load();
const loadMs = performance.now() - started;
const catalog = new Set(Object.keys(globalThis.DailyRecords.recordCatalog));
const japanese = all.filter((record) => record.isJapanesePlayer);
const englishJapanese = japanese.filter((record) =>
    record.playerName && !/[ぁ-んァ-ヶ一-龯]/.test(record.playerName)
);
const badExcluded = japanese.filter((record) => [112252, 118623].includes(Number(record.playerId)));
const uniqueKeys = new Set(all.map((record) => record.archiveKey));
const invalidGamePks = all.filter((record) => !Number(record.gamePk));
const undefinedTypes = all.filter((record) => !catalog.has(record.recordType));
const invalidGameday = all.filter((record) => record.gamedayUrl &&
    !/^https:\/\/www\.mlb\.com\/gameday\/[a-z0-9-]+-vs-[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/\d+\/(?:final|live)$/.test(record.gamedayUrl)
);
const missingDates = all.filter((record) => !/^\d{4}-\d{2}-\d{2}$/.test(record.date));
const byYear = Object.fromEntries(Array.from({ length: 63 }, (_, index) => 1964 + index)
    .map((year) => [year, all.filter((record) => Number(record.season) === year).length]));
const queries = ["イマキュレート", "サイクル", "3本塁打", "野手登板", "大谷", "日本人", "LAD",
    "1964", "1975", "1988", "2001", "2021", "2025", "日本人 3本塁打", "LAD サイクル",
    "2001 イマキュレート", "大谷 3本塁打", "2024/07/22", "2024-07-22"];
const queryResults = {};
let searchMs = 0;
for (const query of queries) {
    const before = performance.now();
    queryResults[query] = globalThis.MLBRecordsArchive.search({ query }).length;
    searchMs += performance.now() - before;
}
const previousExamples = [];
const grouped = new Map();
all.forEach((record) => {
    const values = grouped.get(record.recordType) ?? [];
    values.push(record);
    grouped.set(record.recordType, values);
});
for (const values of grouped.values()) {
    values.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let index = 1; index < values.length; index += 1) {
        const record = values[index];
        const previous = values[index - 1];
        if (Number(record.season) - Number(previous.season) < 5) continue;
        const band = Number(record.season) >= 2020 && Number(previous.season) < 2020 ? "2020s→earlier"
            : Number(record.season) >= 2010 && Number(previous.season) < 2010 ? "2010s→earlier"
                : Number(record.season) >= 2000 && Number(previous.season) < 2000 ? "2000s→earlier" : "";
        if (!band || previousExamples.some((entry) => entry.band === band)) continue;
        previousExamples.push({ band, recordType: record.recordType, current: record.date,
            previous: previous.date, previousGamePk: previous.gamePk, gamedayUrl: previous.gamedayUrl });
    }
}
const fileBytes = (await Promise.all((await fs.readdir(path.join(RECORDS, "backfill")))
    .filter((file) => /^\d{4}\.json$/.test(file))
    .map((file) => fs.stat(path.join(RECORDS, "backfill", file))))).reduce((sum, stat) => sum + stat.size, 0) +
    (await Promise.all([2022, 2023, 2024, 2025, 2026].map((year) =>
        fs.stat(path.join(RECORDS, `${year}.json`))))).reduce((sum, stat) => sum + stat.size, 0);

console.log(JSON.stringify({
    totalRecords: all.length,
    historicalRecords: Object.entries(byYear).filter(([year]) => Number(year) <= 2021)
        .reduce((sum, [, count]) => sum + count, 0),
    currentRecords: Object.entries(byYear).filter(([year]) => Number(year) >= 2022)
        .reduce((sum, [, count]) => sum + count, 0),
    japaneseRecords: japanese.length,
    englishJapanese: englishJapanese.length,
    excludedStillJapanese: badExcluded.length,
    duplicateKeys: all.length - uniqueKeys.size,
    invalidGamePks: invalidGamePks.length,
    undefinedRecordTypes: undefinedTypes.length,
    invalidGamedayUrls: invalidGameday.length,
    missingDates: missingDates.length,
    rangeLabel: globalThis.MLBRecordsArchive.rangeLabel(),
    archiveBytes: fileBytes,
    loadMs: Number(loadMs.toFixed(1)),
    averageSearchMs: Number((searchMs / queries.length).toFixed(2)),
    queryResults,
    previousExamples
}, null, 2));
