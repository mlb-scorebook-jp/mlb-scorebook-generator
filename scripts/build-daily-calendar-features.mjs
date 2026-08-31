#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAME_BASE = path.join(ROOT, "data", "game-base", "years");
const RECORDS = path.join(ROOT, "data", "records");
const BIRTHDAY_ROOT = path.join(ROOT, "data", "birthday");
const ON_THIS_DAY_ROOT = path.join(ROOT, "data", "on-this-day");
const CACHE_FILE = path.join(BIRTHDAY_ROOT, "player-roster-cache.json");
const MODERN_CACHE_FILE = path.join(BIRTHDAY_ROOT, "modern-game-cache.json");
const REPORT_FILE = path.join(ROOT, "data", "daily-calendar-features-report.json");
const API = "https://statsapi.mlb.com/api/v1";
const FIRST_YEAR = 1964;
const LAST_GAME_BASE_YEAR = 2021;
const LAST_YEAR = Number(process.env.MLB_CALENDAR_END_YEAR || new Date().getUTCFullYear());
const REFRESH = process.argv.includes("--refresh-cache");
const REFRESH_MODERN = process.argv.includes("--refresh-modern");
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(new Date());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = async (file, fallback = null) => {
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
};
const writeJson = async (file, value, pretty = false) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    const body = `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
    JSON.parse(body);
    await fs.writeFile(temporary, body);
    await fs.rename(temporary, file);
};
const writeDataScript = async (file, key, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    const json = JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const body = `window.MLBDailyCalendarData=window.MLBDailyCalendarData||{};window.MLBDailyCalendarData[${JSON.stringify(key)}]=${json};\n`;
    await fs.writeFile(temporary, body);
    await fs.rename(temporary, file);
};
const fetchJson = async (url) => {
    let error;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const response = await fetch(url, { headers: { "user-agent": "mlb-scorebook-generator-calendar/1" } });
            if (response.ok) return response.json();
            error = new Error(`HTTP ${response.status}`);
            if (response.status < 500 && response.status !== 429) break;
        } catch (caught) { error = caught; }
        await wait(400 * (attempt + 1));
    }
    throw error;
};
const indexOf = (columns) => Object.fromEntries(columns.map((name, index) => [name, index]));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const add = (target, key, value) => { target[key] = number(target[key]) + number(value); };
const dateInside = (date, start, end) => date >= start && (!end || date <= end);
const inDisplaySeason = (monthDay) => monthDay >= "03-18" && monthDay <= "11-05";
const activeMlbTeamIds = new Set();
const playerIds = new Set();
const latestPlayerIds = new Set();
const birthdayGameLines = new Map();

const emptyHitting = () => ({ G: 0, PA: 0, AB: 0, R: 0, H: 0, doubles: 0, triples: 0,
    HR: 0, RBI: 0, BB: 0, HBP: 0, SO: 0, SB: 0, CS: 0, GIDP: 0, TB: 0, E: 0 });
const emptyPitching = () => ({ G: 0, GS: 0, W: 0, L: 0, SV: 0, outs: 0, H: 0, R: 0,
    ER: 0, BB: 0, HBP: 0, SO: 0, HR: 0, CG: 0, SHO: 0 });
const lineFor = (playerId, date, gamePk) => {
    const key = `${playerId}:${date}:${gamePk}`;
    if (!birthdayGameLines.has(key)) birthdayGameLines.set(key, {
        playerId, date, gamePk, hitting: emptyHitting(), pitching: emptyPitching(), highlights: []
    });
    return birthdayGameLines.get(key);
};
const addHighlight = (line, label) => {
    if (label && !line.highlights.includes(label)) line.highlights.push(label);
};
const statValue = (stat, key) => number(stat?.[key]);
const modernLineFromSplit = (playerId, group, split) => {
    const stat = split?.stat ?? {};
    const line = lineFor(playerId, split.date, number(split?.game?.gamePk));
    line.teamId = number(split?.team?.id);
    if (group === "hitting") {
        line.hitting.G = Math.max(line.hitting.G, statValue(stat, "gamesPlayed"));
        for (const [target, source] of [["PA","plateAppearances"],["AB","atBats"],["R","runs"],
            ["H","hits"],["doubles","doubles"],["triples","triples"],["HR","homeRuns"],
            ["RBI","rbi"],["BB","baseOnBalls"],["HBP","hitByPitch"],["SO","strikeOuts"],
            ["SB","stolenBases"],["CS","caughtStealing"],["GIDP","groundIntoDoublePlay"],
            ["TB","totalBases"]]) add(line.hitting, target, stat[source]);
    } else if (group === "pitching") {
        line.pitching.G = Math.max(line.pitching.G, statValue(stat, "gamesPlayed") || statValue(stat, "gamesPitched"));
        for (const [target, source] of [["GS","gamesStarted"],["W","wins"],["L","losses"],
            ["SV","saves"],["outs","outs"],["H","hits"],["R","runs"],["ER","earnedRuns"],
            ["BB","baseOnBalls"],["HBP","hitByPitch"],["SO","strikeOuts"],["HR","homeRuns"],
            ["CG","completeGames"],["SHO","shutouts"]]) add(line.pitching, target, stat[source]);
    } else if (group === "fielding") {
        line.hitting.G = Math.max(line.hitting.G, statValue(stat, "gamesPlayed"));
        line.hitting.E = Math.max(line.hitting.E, statValue(stat, "errors"));
    }
    return line;
};
const addLineHighlights = (line) => {
    const hitting = line.hitting;
    if (hitting.HR >= 2) addHighlight(line, `誕生日に${hitting.HR}本塁打`);
    else if (hitting.HR === 1) addHighlight(line, "誕生日に本塁打");
    if (hitting.H >= 3) addHighlight(line, `誕生日に${hitting.H}安打`);
    if (hitting.RBI >= 3) addHighlight(line, `誕生日に${hitting.RBI}打点`);
    if (hitting.SO >= 4) addHighlight(line, `誕生日に${hitting.SO}三振`);
    if (hitting.GIDP >= 2) addHighlight(line, `誕生日に${hitting.GIDP}併殺打`);
    if (hitting.E >= 1) addHighlight(line, `誕生日に${hitting.E}失策`);
    const pitching = line.pitching;
    if (pitching.W) addHighlight(line, "誕生日に勝利");
    if (pitching.L) addHighlight(line, "誕生日に敗戦");
    if (pitching.CG) addHighlight(line, "誕生日に完投");
    if (pitching.SHO) addHighlight(line, "誕生日に完封");
    if (pitching.SO >= 10) addHighlight(line, `誕生日に${pitching.SO}奪三振`);
    if (pitching.SV) addHighlight(line, "誕生日にセーブ");
    if (pitching.R >= 6) addHighlight(line, `誕生日に${pitching.R}失点`);
    if (pitching.GS && pitching.outs <= 9 && pitching.R >= 4) addHighlight(line, "誕生日に早期KO");
    if (pitching.HR >= 2) addHighlight(line, `誕生日に${pitching.HR}被本塁打`);
};

// Load the full regular-season game base once. It supplies player IDs, team IDs and
// exact per-game lines for birthday career totals through 2021.
const gameBaseRows = [];
for (let year = FIRST_YEAR; year <= LAST_GAME_BASE_YEAR; year += 1) {
    const payload = await readJson(path.join(GAME_BASE, `${year}.json`));
    if (!payload) continue;
    gameBaseRows.push(payload);
    const gi = indexOf(payload.columns.game);
    const ti = indexOf(payload.columns.team);
    const bi = indexOf(payload.columns.batter);
    const pi = indexOf(payload.columns.pitcher);
    for (const game of payload.games ?? []) {
        for (const team of [game[gi.away], game[gi.home]]) {
            activeMlbTeamIds.add(number(team?.[ti.teamId]));
            for (const row of team?.[ti.batters] ?? []) playerIds.add(number(row[bi.playerId]));
            for (const row of team?.[ti.pitchers] ?? []) playerIds.add(number(row[pi.playerId]));
        }
    }
}
playerIds.delete(0);

// Add modern-season players even when they are absent from the 1964-2021 base.
// The current season is refreshed on every build so new call-ups and roster
// changes do not remain hidden behind the historical cache.
const existingCache = await readJson(CACHE_FILE);
if (REFRESH || !existingCache) {
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
        const payload = await fetchJson(`${API}/sports/1/players?season=${year}`);
        (payload.people ?? []).forEach((person) => {
            playerIds.add(number(person.id));
            if (year === LAST_YEAR) latestPlayerIds.add(number(person.id));
        });
        process.stdout.write(`\rPlayer pools ${year}/${LAST_YEAR}`);
    }
    process.stdout.write("\n");
} else {
    const payload = await fetchJson(`${API}/sports/1/players?season=${LAST_YEAR}`);
    (payload.people ?? []).forEach((person) => {
        playerIds.add(number(person.id)); latestPlayerIds.add(number(person.id));
    });
}

let cache = existingCache ?? { schemaVersion: 1, players: {} };
if (REFRESH) cache = { schemaVersion: 1, players: {} };
const missingIds = [...playerIds].filter((id) => !cache.players[id]);
const peopleIds = [...new Set([...missingIds, ...latestPlayerIds])];
for (let start = 0; start < peopleIds.length; start += 50) {
    const ids = peopleIds.slice(start, start + 50);
    const payload = await fetchJson(`${API}/people?personIds=${ids.join(",")}&hydrate=rosterEntries`);
    for (const person of payload.people ?? []) {
        const intervals = (person.rosterEntries ?? []).filter((entry) =>
            activeMlbTeamIds.has(number(entry?.team?.id)) && entry?.startDate
        ).map((entry) => ({
            teamId: number(entry.team.id), teamName: entry.team.name ?? "",
            teamCode: entry.team.abbreviation ?? "", start: entry.startDate,
            end: entry.endDate ?? "", status: entry.status?.code ?? ""
        }));
        cache.players[person.id] = {
            playerId: number(person.id), fullName: person.fullName ?? "",
            birthDate: person.birthDate ?? "", position: person.primaryPosition?.abbreviation ?? "",
            intervals
        };
    }
    cache.updatedAt = new Date().toISOString();
    await writeJson(CACHE_FILE, cache);
    process.stdout.write(`\rPeople ${Math.min(start + ids.length, peopleIds.length)}/${peopleIds.length}`);
}
if (peopleIds.length) process.stdout.write("\n");

// Aggregate birthday game lines now that every player birth date is available.
for (const payload of gameBaseRows) {
    const gi = indexOf(payload.columns.game);
    const ti = indexOf(payload.columns.team);
    const bi = indexOf(payload.columns.batter);
    const pi = indexOf(payload.columns.pitcher);
    for (const game of payload.games ?? []) {
        const date = String(game[gi.officialDate] ?? "");
        for (const team of [game[gi.away], game[gi.home]]) {
            for (const row of team?.[ti.batters] ?? []) {
                const id = number(row[bi.playerId]);
                if (!id || cache.players[id]?.birthDate?.slice(5) !== date.slice(5) || number(row[bi.PA]) <= 0) continue;
                const line = lineFor(id, date, number(game[gi.gamePk]));
                line.teamId = number(team[ti.teamId]);
                const stat = line.hitting; stat.G = 1;
                for (const [target, source] of [["PA","PA"],["AB","AB"],["R","R"],["H","H"],
                    ["doubles","2B"],["triples","3B"],["HR","HR"],["RBI","RBI"],["BB","BB"],
                    ["HBP","HBP"],["SO","SO"],["SB","SB"],["CS","CS"],["GIDP","GIDP"],
                    ["TB","totalBases"],["E","E"]]) add(stat, target, row[bi[source]]);
                if (stat.HR >= 2) addHighlight(line, `誕生日に${stat.HR}本塁打`);
                else if (stat.HR === 1) addHighlight(line, "誕生日に本塁打");
                if (stat.H >= 3) addHighlight(line, `誕生日に${stat.H}安打`);
                if (stat.RBI >= 3) addHighlight(line, `誕生日に${stat.RBI}打点`);
                if (stat.SO >= 4) addHighlight(line, `誕生日に${stat.SO}三振`);
                if (stat.GIDP >= 2) addHighlight(line, `誕生日に${stat.GIDP}併殺打`);
                if (stat.E >= 1) addHighlight(line, `誕生日に${stat.E}失策`);
            }
            for (const row of team?.[ti.pitchers] ?? []) {
                const id = number(row[pi.playerId]);
                if (!id || cache.players[id]?.birthDate?.slice(5) !== date.slice(5) || number(row[pi.outs]) <= 0) continue;
                const line = lineFor(id, date, number(game[gi.gamePk]));
                line.teamId = number(team[ti.teamId]);
                const stat = line.pitching; stat.G = 1;
                for (const [target, source] of [["GS","gamesStarted"],["W","wins"],["L","losses"],
                    ["SV","saves"],["outs","outs"],["H","H"],["R","R"],["ER","ER"],
                    ["BB","BB"],["HBP","HBP"],["SO","SO"],["HR","HR"],
                    ["CG","completeGames"],["SHO","shutouts"]]) add(stat, target, row[pi[source]]);
                if (stat.W) addHighlight(line, "誕生日に勝利");
                if (stat.L) addHighlight(line, "誕生日に敗戦");
                if (stat.CG) addHighlight(line, "誕生日に完投");
                if (stat.SHO) addHighlight(line, "誕生日に完封");
                if (stat.SO >= 10) addHighlight(line, `誕生日に${stat.SO}奪三振`);
                if (stat.SV) addHighlight(line, "誕生日にセーブ");
                if (stat.R >= 6) addHighlight(line, `誕生日に${stat.R}失点`);
                if (stat.GS && stat.outs <= 9 && stat.R >= 4) addHighlight(line, "誕生日に早期KO");
                if (stat.HR >= 2) addHighlight(line, `誕生日に${stat.HR}被本塁打`);
            }
        }
    }
}

// Fill 2022 onward from MLB's official player game logs, limited to each
// player's birthday. This avoids adding another multi-year full-game database.
let modernCache = await readJson(MODERN_CACHE_FILE, { schemaVersion: 1, dates: {} });
if (REFRESH_MODERN) modernCache = { schemaVersion: 1, dates: {} };
const modernTasks = [];
for (let year = LAST_GAME_BASE_YEAR + 1; year <= LAST_YEAR; year += 1) {
    for (const monthDay of Array.from({ length: 366 }, (_, offset) => {
        const date = new Date(Date.UTC(2024, 0, offset + 1));
        return date.toISOString().slice(5, 10);
    }).filter((value, index, values) => values.indexOf(value) === index && inDisplaySeason(value))) {
        const date = `${year}-${monthDay}`;
        if (date > TODAY) continue;
        const ids = Object.values(cache.players).filter((player) =>
            player.birthDate?.slice(5) === monthDay && player.intervals.some((entry) =>
                dateInside(date, entry.start, entry.end)
            )
        ).map((player) => player.playerId);
        if (ids.length) modernTasks.push({ date, ids });
    }
}
let modernDone = 0;
let modernCursor = 0;
const currentYear = Number(TODAY.slice(0, 4));
const modernWorker = async () => {
    while (modernCursor < modernTasks.length) {
        const task = modernTasks[modernCursor++];
        const refresh = REFRESH_MODERN || Number(task.date.slice(0, 4)) === currentYear;
        if (!modernCache.dates[task.date] || refresh) {
            const hydrate = `stats(group=[hitting,pitching,fielding],type=[gameLog],startDate=${task.date},endDate=${task.date})`;
            const payload = await fetchJson(`${API}/people?personIds=${task.ids.join(",")}&hydrate=${encodeURIComponent(hydrate)}`);
            const touched = new Set();
            for (const person of payload.people ?? []) {
                for (const statGroup of person.stats ?? []) {
                    const group = statGroup.group?.displayName;
                    for (const split of statGroup.splits ?? []) {
                        if (split.date !== task.date || split.gameType !== "R" || !split?.game?.gamePk) continue;
                        touched.add(modernLineFromSplit(number(person.id), group, split));
                    }
                }
            }
            for (const line of touched) addLineHighlights(line);
            modernCache.dates[task.date] = [...touched];
        } else {
            for (const line of modernCache.dates[task.date]) {
                birthdayGameLines.set(`${line.playerId}:${line.date}:${line.gamePk}`, line);
            }
        }
        modernDone += 1;
        if (modernDone % 25 === 0 || modernDone === modernTasks.length) {
            process.stdout.write(`\rModern birthday logs ${modernDone}/${modernTasks.length}`);
        }
    }
};
await Promise.all(Array.from({ length: Math.min(6, modernTasks.length || 1) }, modernWorker));
modernCache.updatedAt = new Date().toISOString();
modernCache.throughDate = TODAY;
await writeJson(MODERN_CACHE_FILE, modernCache);
if (modernTasks.length) process.stdout.write("\n");

const linesByPlayer = new Map();
for (const line of birthdayGameLines.values()) {
    if (!linesByPlayer.has(line.playerId)) linesByPlayer.set(line.playerId, []);
    linesByPlayer.get(line.playerId).push(line);
}
for (const lines of linesByPlayer.values()) lines.sort((a, b) => a.date.localeCompare(b.date) || a.gamePk - b.gamePk);

const birthdayFiles = [];
const byMonthDay = new Map();
for (const player of Object.values(cache.players)) {
    const monthDay = player.birthDate?.slice(5);
    if (!/^\d{2}-\d{2}$/.test(monthDay ?? "") || !inDisplaySeason(monthDay)) continue;
    if (!byMonthDay.has(monthDay)) byMonthDay.set(monthDay, []);
    byMonthDay.get(monthDay).push({
        playerId: player.playerId, fullName: player.fullName, birthDate: player.birthDate,
        position: player.position, roster: player.intervals,
        birthdayGames: linesByPlayer.get(player.playerId) ?? []
    });
}
for (const [monthDay, players] of [...byMonthDay].sort()) {
    const output = path.join(BIRTHDAY_ROOT, "by-day", `${monthDay}.json`);
    await writeJson(output, { schemaVersion: 1, monthDay, statsRange: { start: 1964, end: LAST_YEAR,
        endDate: modernCache.throughDate, gameTypes: ["R"] }, players });
    await writeDataScript(output.replace(/\.json$/, ".js"), `birthday:${monthDay}`,
        { schemaVersion: 1, monthDay, statsRange: { start: 1964, end: LAST_YEAR,
            endDate: modernCache.throughDate, gameTypes: ["R"] }, players });
    birthdayFiles.push(output);
}

const ON_THIS_DAY_TYPES = Object.freeze({
    PERFECT_GAME: [100, "完全試合"], SOLO_NO_HITTER: [98, "ノーヒッター"],
    COMBINED_NO_HITTER: [97, "継投ノーヒッター"], CYCLE: [92, "サイクル安打"],
    FOUR_HR_GAME: [96, "1試合4本塁打"], THREE_HR_GAME: [88, "1試合3本塁打"],
    WALKOFF_GRAND_SLAM: [94, "サヨナラ満塁本塁打"],
    PINCH_HIT_WALKOFF_GRAND_SLAM: [95, "代打サヨナラ満塁本塁打"],
    PINCH_HIT_WALKOFF_HOME_RUN: [90, "代打サヨナラ本塁打"],
    WALKOFF_WILD_PITCH: [82, "サヨナラ暴投"],
    TRIPLE_PLAY: [82, "三重殺"], UNASSISTED_TRIPLE_PLAY: [96, "無補殺三重殺"],
    FIFTEEN_INNING_GAME: [78, "延長15回以上"], EIGHTEEN_INNING_GAME: [84, "延長18回以上"],
    TWENTY_RUN_GAME: [84, "チーム20得点以上"], TWENTY_FIVE_RUN_GAME: [90, "チーム25得点以上"],
    HOMER_AND_PITCH: [80, "投手が本塁打＋登板"], HOMER_AND_WIN: [86, "投手が本塁打＋勝利"],
    POSITION_PLAYER_STRIKEOUT: [76, "野手登板で奪三振"],
    POSITION_PLAYER_MULTI_STRIKEOUT: [82, "野手登板で複数奪三振"],
    POSITION_PLAYER_WIN: [86, "野手登板で勝利"], POSITION_PLAYER_SAVE: [88, "野手登板でセーブ"],
    POSITION_PLAYER_NO_HIT: [78, "野手登板で被安打0"],
    THREE_CONSECUTIVE_HR: [82, "3者連続本塁打"], FOUR_CONSECUTIVE_HR: [92, "4者連続本塁打"]
});
const recordIndex = await readJson(path.join(RECORDS, "index.json"), { archives: [] });
const eventGroups = new Map();
for (const archive of recordIndex.archives ?? []) {
    const rows = await readJson(path.join(RECORDS, archive.path), []);
    for (const record of rows ?? []) {
        const config = ON_THIS_DAY_TYPES[record.recordType];
        const monthDay = String(record.date ?? "").slice(5);
        if (!config || !inDisplaySeason(monthDay)) continue;
        let family = record.recordType;
        if (["HOMER_AND_WIN", "HOMER_AND_PITCH"].includes(family)) family = "PITCHER_HOMER_RESULT";
        if (family.startsWith("POSITION_PLAYER_")) family = "POSITION_PLAYER_PITCHING";
        if (["FIFTEEN_INNING_GAME", "EIGHTEEN_INNING_GAME"].includes(family)) family = "LONG_GAME";
        if (["TWENTY_RUN_GAME", "TWENTY_FIVE_RUN_GAME"].includes(family)) family = "HIGH_SCORE";
        const subject = number(record.playerId) || number(record.teamId) || "game";
        const key = `${record.gamePk}:${subject}:${family}`;
        const current = eventGroups.get(key) ?? {
            monthDay, date: record.date, gamePk: number(record.gamePk), playerId: number(record.playerId) || null,
            playerName: record.playerName ?? "", teamId: number(record.teamId) || null,
            teamCode: record.teamCode ?? "", opponentCode: record.opponentCode ?? "",
            facts: [], recordTypes: [], priority: 0, gamedayUrl: record.gamedayUrl ?? ""
        };
        current.priority = Math.max(current.priority, config[0]);
        if (!current.facts.includes(record.fact)) current.facts.push(record.fact);
        if (!current.recordTypes.includes(record.recordType)) current.recordTypes.push(record.recordType);
        eventGroups.set(key, current);
    }
}
const historyByDay = new Map();
for (const event of eventGroups.values()) {
    if (!historyByDay.has(event.monthDay)) historyByDay.set(event.monthDay, []);
    const hasHomerWin = event.recordTypes.includes("HOMER_AND_WIN");
    event.summary = hasHomerWin ? "本塁打を放ち、勝利投手になった"
        : event.recordTypes.some((type) => type.startsWith("POSITION_PLAYER_"))
            ? `野手登板（${event.facts.join("、")}）`
            : event.facts.join("、");
    delete event.facts;
    historyByDay.get(event.monthDay).push(event);
}
const historyFiles = [];
for (const [monthDay, events] of [...historyByDay].sort()) {
    events.sort((a, b) => b.priority - a.priority || b.date.localeCompare(a.date));
    const output = path.join(ON_THIS_DAY_ROOT, "by-day", `${monthDay}.json`);
    await writeJson(output, { schemaVersion: 1, monthDay, source: "existing-records",
        events });
    await writeDataScript(output.replace(/\.json$/, ".js"), `history:${monthDay}`,
        { schemaVersion: 1, monthDay, source: "existing-records", events });
    historyFiles.push(output);
}

const fileStats = async (files) => Promise.all(files.map(async (file) => ({
    path: path.relative(ROOT, file), size: (await fs.stat(file)).size
})));
const birthdayStats = await fileStats(birthdayFiles);
const historyStats = await fileStats(historyFiles);
const birthdayScriptStats = await fileStats(birthdayFiles.map((file) => file.replace(/\.json$/, ".js")));
const historyScriptStats = await fileStats(historyFiles.map((file) => file.replace(/\.json$/, ".js")));
const summarize = (rows) => ({ files: rows.length, totalBytes: rows.reduce((sum, row) => sum + row.size, 0),
    maxBytes: Math.max(0, ...rows.map((row) => row.size)),
    averageBytes: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.size, 0) / rows.length) : 0 });
const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), playerCount: Object.keys(cache.players).length,
    activeDefinition: "MLB-team rosterEntries interval contains selected date",
    birthday: summarize(birthdayStats), onThisDay: summarize(historyStats),
    localFileFallback: {
        birthday: summarize(birthdayScriptStats), onThisDay: summarize(historyScriptStats)
    },
    statsRange: { start: 1964, end: LAST_YEAR, endDate: modernCache.throughDate, gameTypes: ["R"] },
    recordTypes: Object.keys(ON_THIS_DAY_TYPES)
};
await writeJson(REPORT_FILE, report, true);
console.log(JSON.stringify(report, null, 2));
