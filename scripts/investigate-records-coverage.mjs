#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = "https://statsapi.mlb.com/api";
const args = process.argv.slice(2);
const option = (name, fallback = "") => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
};
const years = option("years", "2021,2020,2018,2015,2010,2005,2000,1995,1990,1980,1970,1960,1950,1940,1930,1920,1910,1901")
    .split(",").map(Number).filter(Number.isInteger);
const samplesPerYear = Math.max(3, Math.min(12, Number(option("samples", 6)) || 6));
const output = path.join(ROOT, "data", "records", "coverage.json");
const reportOutput = path.join(ROOT, "data", "records", "coverage-investigation-report.json");
const currentArchiveReport = path.join(ROOT, "data", "records", "2026-build-report.json");
let apiRequests = 0;

const REQUIREMENTS = Object.freeze({
    JAPANESE_CAREER_HIGH: ["boxscore", "playerStats", "careerGameLog"],
    JAPANESE_CAREER_WORST: ["boxscore", "playerStats", "careerGameLog"],
    TWO_HR_SAME_INNING: ["playByPlay", "completePlays", "eventType", "inning", "batter"],
    TWO_HIT_SAME_INNING: ["playByPlay", "completePlays", "eventType", "inning", "batter"],
    LARGE_RBI_INNING: ["playByPlay", "completePlays", "rbi", "inning", "batter"],
    THREE_HR_GAME: ["playByPlay", "completePlays", "eventType", "batter"],
    FIVE_HIT_GAME: ["playByPlay", "completePlays", "eventType", "batter"],
    SIX_HIT_GAME: ["playByPlay", "completePlays", "eventType", "batter"],
    CYCLE: ["playByPlay", "completePlays", "eventType", "batter"],
    LEADOFF_FIRST_PITCH_HR: ["playByPlay", "completePlays", "eventType", "inning", "batter", "pitchEvents", "pitchNumber"],
    FOUR_SB_GAME: ["playByPlay", "completePlays", "eventType", "runners"],
    LARGE_RBI_GAME: ["playByPlay", "completePlays", "rbi", "batter"],
    TWO_OUTS_SAME_INNING: ["playByPlay", "completePlays", "eventType", "inning", "batter"],
    THREE_CONSECUTIVE_HR: ["playByPlay", "completePlays", "eventType", "inning", "batter"],
    FOUR_CONSECUTIVE_HR: ["playByPlay", "completePlays", "eventType", "inning", "batter"],
    WALKOFF_GRAND_SLAM: ["playByPlay", "completePlays", "eventType", "inning", "rbi", "runners"],
    FOUR_STRIKEOUT_INNING: ["playByPlay", "completePlays", "eventType", "inning", "pitcher"],
    IMMACULATE_INNING: ["playByPlay", "completePlays", "eventType", "inning", "pitcher", "pitchEvents", "pitchCall", "count"],
    POSITION_PLAYER_STRIKEOUT: ["boxscore", "playerStats", "pitchers", "positions", "peoplePosition"],
    POSITION_PLAYER_MULTI_STRIKEOUT: ["boxscore", "playerStats", "pitchers", "positions", "peoplePosition"],
    POSITION_PLAYER_WIN: ["boxscore", "playerStats", "pitchers", "positions", "peoplePosition"],
    POSITION_PLAYER_SAVE: ["boxscore", "playerStats", "pitchers", "positions", "peoplePosition"],
    LOW_HIT_WIN: ["boxscore", "teamStats", "linescore"],
    RUN_WITHOUT_HIT: ["playByPlay", "completePlays", "inning", "eventType", "linescore"],
    HIT_DEFICIT_WIN: ["boxscore", "teamStats", "linescore"],
    LARGE_RUN_INNING: ["playByPlay", "completePlays", "inning", "rbi", "linescore"],
    LARGE_HR_INNING: ["playByPlay", "completePlays", "eventType", "inning"],
    COMBINED_LARGE_HR: ["boxscore", "teamStats"],
    COMBINED_MANY_PITCHERS: ["boxscore", "pitchers"],
    EXTREME_WALKS: ["boxscore", "teamStats"],
    COMBINED_NO_HITTER: ["boxscore", "teamStats", "pitchers", "linescore"],
    NO_HIT_LOSS: ["boxscore", "teamStats", "linescore"],
    TRIPLE_PLAY: ["playByPlay", "completePlays", "eventType", "runners"],
    ALL_STARTERS_HIT: ["boxscore", "playerStats", "battingOrder"],
    ALL_STARTERS_SCORE: ["boxscore", "playerStats", "battingOrder"]
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchJson = async (url) => {
    apiRequests += 1;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(url, { headers: { "user-agent": "mlb-scorebook-generator-coverage-audit" } });
            if (response.ok) return { ok: true, data: await response.json(), status: response.status };
            lastError = new Error(`HTTP ${response.status}`);
            if (response.status < 500 && response.status !== 429) break;
        } catch (error) { lastError = error; }
        await wait(400 * (attempt + 1));
    }
    return { ok: false, data: null, status: lastError?.message || "fetch failed" };
};
const atomicWrite = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    JSON.parse(json);
    await fs.writeFile(temporary, json, "utf8");
    await fs.rename(temporary, file);
};
const readJson = async (file, fallback) => {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (_error) { return fallback; }
};
const chooseSamples = (games, count) => {
    if (games.length <= count) return games;
    const picked = [];
    for (let index = 0; index < count; index += 1) {
        picked.push(games[Math.round(index * (games.length - 1) / (count - 1))]);
    }
    return [...new Map(picked.map((game) => [game.gamePk, game])).values()];
};
const inspect = (game, boxscore, pbp) => {
    const teams = [boxscore?.teams?.away, boxscore?.teams?.home].filter(Boolean);
    const players = teams.flatMap((team) => Object.values(team?.players ?? {}));
    const plays = Array.isArray(pbp?.allPlays) ? pbp.allPlays : [];
    const complete = plays.filter((play) => play?.about?.isComplete === true);
    const events = complete.flatMap((play) => play?.playEvents ?? []);
    const pitches = events.filter((event) => event?.isPitch === true);
    const capabilities = {
        schedule: Boolean(game?.gamePk && game?.officialDate && game?.teams?.away?.team?.id && game?.teams?.home?.team?.id),
        linescore: Boolean(game?.linescore?.innings?.length || game?.teams?.away?.score !== undefined),
        boxscore: teams.length === 2,
        teamStats: teams.length === 2 && teams.every((team) => team?.teamStats?.batting && team?.teamStats?.pitching),
        playerStats: players.some((entry) => entry?.stats?.batting || entry?.stats?.pitching),
        battingOrder: players.some((entry) => String(entry?.battingOrder || "").length >= 3),
        pitchers: teams.length === 2 && teams.every((team) => Array.isArray(team?.pitchers)),
        positions: players.some((entry) => Array.isArray(entry?.allPositions) && entry.allPositions.length),
        peoplePosition: players.some((entry) => entry?.position || entry?.person?.primaryPosition),
        playByPlay: Array.isArray(pbp?.allPlays),
        completePlays: complete.length > 0,
        eventType: complete.some((play) => play?.result?.eventType || play?.result?.event),
        inning: complete.some((play) => Number(play?.about?.inning) > 0 && (play?.about?.halfInning || play?.about?.isTopInning !== undefined)),
        batter: complete.some((play) => Number(play?.matchup?.batter?.id) > 0),
        pitcher: complete.some((play) => Number(play?.matchup?.pitcher?.id) > 0),
        runners: complete.some((play) => Array.isArray(play?.runners)),
        rbi: complete.some((play) => play?.result?.rbi !== undefined),
        pitchEvents: pitches.length > 0,
        pitchCall: pitches.some((pitch) => pitch?.details?.call?.code || pitch?.details?.description),
        pitchNumber: pitches.some((pitch) => pitch?.pitchNumber !== undefined || pitch?.index !== undefined),
        count: pitches.some((pitch) => pitch?.count?.balls !== undefined && pitch?.count?.strikes !== undefined),
        careerGameLog: null
    };
    return { capabilities, counts: { players: players.length, plays: plays.length, completePlays: complete.length,
        playEvents: events.length, pitches: pitches.length } };
};
const statusFor = (results, requirements) => {
    const relevant = requirements.filter((field) => field !== "careerGameLog");
    const tested = results.length;
    const passing = results.filter((result) => relevant.every((field) => result.capabilities[field] === true)).length;
    if (!tested || passing === 0) return { status: "unavailable", passing, tested };
    if (passing === tested && requirements.includes("careerGameLog")) return { status: "partial", passing, tested };
    if (passing === tested) return { status: "sample-verified", passing, tested };
    return { status: "partial", passing, tested };
};

const startedAt = new Date();
const previousReport = await readJson(reportOutput, null);
const archiveReport = await readJson(currentArchiveReport, null);
const verifiedThrough = archiveReport?.range?.endDate || new Date().toISOString().slice(0, 10);
const yearResults = [];
for (const year of years) {
    const scheduleUrl = `${API_ROOT}/v1/schedule?sportId=1&gameTypes=R&startDate=${year}-01-01&endDate=${year}-12-31&hydrate=team,linescore`;
    const schedule = await fetchJson(scheduleUrl);
    const games = (schedule.data?.dates ?? []).flatMap((date) => date?.games ?? [])
        .filter((game) => Number(game?.gamePk) && (game?.status?.codedGameState === "F" || game?.status?.abstractGameState === "Final"));
    const samples = chooseSamples(games, samplesPerYear);
    const inspected = [];
    for (const game of samples) {
        const [box, pbp] = await Promise.all([
            fetchJson(`${API_ROOT}/v1/game/${game.gamePk}/boxscore`),
            fetchJson(`${API_ROOT}/v1/game/${game.gamePk}/playByPlay`)
        ]);
        inspected.push({ gamePk: Number(game.gamePk), date: game.officialDate,
            endpoints: { boxscore: box.ok, playByPlay: pbp.ok },
            ...inspect(game, box.data, pbp.data) });
    }
    const recordTypes = Object.fromEntries(Object.entries(REQUIREMENTS).map(([recordType, required]) =>
        [recordType, statusFor(inspected, required)]));
    yearResults.push({ year, schedule: { ok: schedule.ok, games: games.length }, samples: inspected, recordTypes });
    console.log(`${year}: games=${games.length}, samples=${inspected.length}`);
}

const mergedYearResults = [...new Map([
    ...(previousReport?.years ?? []),
    ...yearResults
].map((entry) => [Number(entry.year), entry])).values()].sort((a, b) => b.year - a.year);

const now = new Date().toISOString();
const records = Object.fromEntries(Object.entries(REQUIREMENTS).map(([recordType, requiredData]) => {
    const verifiedYears = mergedYearResults.filter((year) => year.recordTypes[recordType].status === "sample-verified")
        .map((year) => year.year).sort((a, b) => a - b);
    const partialYears = mergedYearResults.filter((year) => year.recordTypes[recordType].status === "partial")
        .map((year) => year.year).sort((a, b) => a - b);
    const unavailableYears = mergedYearResults.filter((year) => year.recordTypes[recordType].status === "unavailable")
        .map((year) => year.year).sort((a, b) => a - b);
    const candidateStartYear = verifiedYears[0] ?? null;
    return [recordType, {
        recordType,
        coverage: {
            coverageStartYear: null,
            coverageStartDate: null,
            candidateStartYear,
            endYear: 2026,
            verifiedThrough,
            status: "investigating",
            complete: false,
            requiredData,
            sampleVerifiedYears: verifiedYears,
            partialYears,
            unavailableYears,
            insufficientData: mergedYearResults.map((year) => ({ year: year.year,
                passingSamples: year.recordTypes[recordType].passing,
                testedSamples: year.recordTypes[recordType].tested })),
            note: requiredData.includes("careerGameLog")
                ? "日本人キャリア記録は選手ごとのMLBデビュー以降を母集団とし、別途Game Log完全性監査が必要。"
                : "サンプル確認だけでは完全カバレッジと断定しない。境界年の全試合監査後にcoverageStartYearを確定する。"
        }
    }];
}));
const coverage = { schemaVersion: 1, generatedAt: now, verifiedThrough,
    definitions: {
        coverageStartYear: "必要データ欠損なく、その年以降の全対象試合を継続判定できると確認した最古年",
        statuses: ["investigating", "complete", "partial", "unavailable"],
        outcomes: ["checked", "notDetected", "detected", "insufficientData"]
    }, records };
const report = { generatedAt: now, startedAt: startedAt.toISOString(), finishedAt: now,
    apiRequests: Number(previousReport?.apiRequests || 0) + apiRequests,
    yearsRequested: [...new Set([...(previousReport?.yearsRequested ?? []), ...years])].sort((a, b) => b - a),
    samplesPerYear, requirements: REQUIREMENTS, years: mergedYearResults };
await atomicWrite(output, coverage);
await atomicWrite(reportOutput, report);
console.log(`Coverage investigation complete: ${apiRequests} API requests`);
console.log(output);
