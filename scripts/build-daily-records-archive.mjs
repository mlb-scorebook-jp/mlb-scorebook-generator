#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = "https://statsapi.mlb.com/api";
const args = process.argv.slice(2);
const option = (name, fallback = "") => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);
const year = Number(option("year", new Date().getUTCFullYear()));
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const startDate = option("start", `${year}-03-01`);
const endDate = option("end", year === Number(yesterday.slice(0, 4)) ? yesterday : `${year}-12-31`);
const concurrency = Math.max(1, Math.min(5, Number(option("concurrency", 3)) || 3));
const force = hasFlag("force") || hasFlag("rebuild");
const outputPath = path.join(ROOT, "data", "records", `${year}.json`);
const progressPath = path.join(ROOT, "data", "records", `.build-${year}-progress.json`);
const reportPath = path.join(ROOT, "data", "records", `${year}-build-report.json`);
const startedAt = new Date();
let apiRequests = 0;
let scheduleEntries = 0;

if (!Number.isInteger(year) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw new Error("--year、--start、--end の指定が正しくありません。");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
    apiRequests += 1;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await nativeFetch(url, init);
            if (response.ok || (response.status < 500 && response.status !== 429)) return response;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < 2) await wait(500 * (attempt + 1));
    }
    throw lastError;
};

globalThis.window = globalThis;
const memoryStorage = new Map();
globalThis.localStorage = {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => memoryStorage.set(key, String(value)),
    removeItem: (key) => memoryStorage.delete(key),
    key: (index) => [...memoryStorage.keys()][index] ?? null,
    get length() { return memoryStorage.size; }
};
const playerNamesSource = (await fs.readFile(path.join(ROOT, "js", "players.js"), "utf8"))
    .replace(/^const NHK_PLAYER_NAMES\s*=/, "globalThis.NHK_PLAYER_NAMES =");
vm.runInThisContext(playerNamesSource, { filename: "js/players.js" });
await import(path.join(ROOT, "js", "players-2026-updates.js"));
await import(path.join(ROOT, "js", "records-archive.js"));
await import(path.join(ROOT, "js", "daily-records.js"));
const analyzer = globalThis.DailyRecords?.archiveBuilder;
const archive = globalThis.MLBRecordsArchive;
if (!analyzer || !archive) throw new Error("Phase 1共通判定ロジックを読み込めませんでした。");

const readJson = async (file, fallback) => {
    try {
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (_error) {
        return fallback;
    }
};
const atomicWriteJson = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    JSON.parse(json);
    await fs.writeFile(temporary, json, "utf8");
    await fs.rename(temporary, file);
};
const isFinal = (game) => {
    const status = game?.status ?? {};
    return String(status.codedGameState).toUpperCase() === "F" ||
        String(status.abstractGameState).toLowerCase() === "final" ||
        String(status.detailedState).toLowerCase().includes("final") ||
        String(status.detailedState).toLowerCase().includes("completed early");
};
const normalizeRecord = (record) => ({
    ...record,
    uniqueKey: archive.archiveKey(record),
    archiveKey: archive.archiveKey(record),
    description: String(record.description || record.fact || ""),
    isJapanesePlayer: record.category === "japanese" || record.isJapanesePlayer === true,
    apiConfirmed: record.apiConfirmed !== false && record.apiStatus !== "unconfirmed",
    gamedayUrl: archive.repairGamedayUrl(record.gamedayUrl),
    articleUrls: Array.isArray(record.articleUrls) ? record.articleUrls : [],
    historicalContext: record.historicalContext ?? { status: "needs-review", text: "", sources: [] }
});
const mergeRecords = (...groups) => {
    const merged = new Map();
    groups.flat().filter(Boolean).forEach((record) => {
        const normalized = normalizeRecord(record);
        merged.set(normalized.uniqueKey, { ...merged.get(normalized.uniqueKey), ...normalized });
    });
    return [...merged.values()].sort((a, b) =>
        String(a.date).localeCompare(String(b.date)) || Number(a.gamePk) - Number(b.gamePk) ||
        String(a.uniqueKey).localeCompare(String(b.uniqueKey))
    );
};
const fetchSchedule = async () => {
    const params = new URLSearchParams({ sportId: "1", startDate, endDate, gameType: "R",
        hydrate: "team,linescore,venue" });
    const response = await fetch(`${API_ROOT}/v1/schedule?${params}`);
    if (!response.ok) throw new Error(`Schedule HTTP ${response.status}`);
    const payload = await response.json();
    const entries = (payload?.dates ?? []).flatMap((entry) => entry?.games ?? [])
        .filter((game) => Number(game?.gamePk) && isFinal(game));
    scheduleEntries = entries.length;
    return [...new Map(entries.map((game) => [Number(game.gamePk), game])).values()];
};

const existingRecords = force ? [] : await readJson(outputPath, []);
const previousProgress = force ? null : await readJson(progressPath, null);
const previousReport = force ? null : await readJson(reportPath, null);
const processed = new Set((previousProgress?.processedGamePks ?? []).map(Number));
let records = mergeRecords(existingRecords, previousProgress?.records ?? []);
const failures = new Map((previousProgress?.failures ?? []).map((failure) => [Number(failure.gamePk), failure]));
const games = await fetchSchedule();
if (!previousProgress && !processed.size && previousReport?.failed === 0 &&
    previousReport?.range?.startDate === startDate && previousReport?.range?.endDate === endDate) {
    (previousReport.processedGamePks ?? games.map((game) => Number(game.gamePk)))
        .forEach((gamePk) => processed.add(Number(gamePk)));
}
const japanesePlayers = await analyzer.fetchJapanesePlayers(year, new AbortController().signal);
let cursor = 0;
let completedThisRun = 0;
let succeededThisRun = 0;
let skipped = 0;

const checkpoint = async () => atomicWriteJson(progressPath, {
    year, startDate, endDate, updatedAt: new Date().toISOString(),
    processedGamePks: [...processed].sort((a, b) => a - b),
    failures: [...failures.values()], records
});
const worker = async () => {
    while (cursor < games.length) {
        const game = games[cursor++];
        const gamePk = Number(game.gamePk);
        if (processed.has(gamePk)) {
            skipped += 1;
            continue;
        }
        try {
            const detected = await analyzer.analyzeOneGame(game, new AbortController().signal,
                japanesePlayers, { includeArticles: false });
            records = mergeRecords(records, detected);
            processed.add(gamePk);
            failures.delete(gamePk);
            succeededThisRun += 1;
        } catch (error) {
            const prior = failures.get(gamePk);
            failures.set(gamePk, { gamePk, date: game.officialDate,
                error: error?.message || String(error), retryCount: Number(prior?.retryCount || 0) + 1 });
        }
        completedThisRun += 1;
        if (completedThisRun % 10 === 0) {
            await checkpoint();
            process.stdout.write(`\rProcessed ${processed.size}/${games.length} | Failed ${failures.size} | Records ${records.length}`);
        }
    }
};

await Promise.all(Array.from({ length: Math.min(concurrency, games.length || 1) }, worker));
await checkpoint();
await atomicWriteJson(outputPath, records);
const byRecordType = Object.fromEntries([...records.reduce((map, record) => {
    map.set(record.recordType, (map.get(record.recordType) || 0) + 1);
    return map;
}, new Map())].sort(([a], [b]) => a.localeCompare(b)));
const finishedAt = new Date();
const report = {
    year, range: { startDate, endDate }, startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(), elapsedSeconds: Math.round((finishedAt - startedAt) / 100) / 10,
    scheduleEntries, finalGames: games.length, processed: processed.size,
    processedThisRun: succeededThisRun, skipped, failed: failures.size,
    recordsDetected: records.length,
    japaneseRecords: records.filter((record) => record.isJapanesePlayer).length,
    apiRequests, outputBytes: Buffer.byteLength(JSON.stringify(records)), byRecordType,
    failures: [...failures.values()],
    processedGamePks: [...processed].sort((a, b) => a - b)
};
await atomicWriteJson(reportPath, report);
process.stdout.write("\n");
console.log(`${year} Archive Build Complete`);
console.log(JSON.stringify(report, null, 2));
if (!failures.size) await fs.rm(progressPath, { force: true });
