import fs from "node:fs";

const [outsideStrikeFile, insideBallFile, scheduleFile, playerCacheFile, outputFile, peopleFile, pitchingStatsFile, calledPitchesFile] = process.argv.slice(2);
if (!outsideStrikeFile || !insideBallFile || !scheduleFile || !playerCacheFile || !outputFile) {
    console.error("Usage: node build-abilities-missed-calls.mjs <outside-strikes.csv> <inside-balls.csv> <schedule.json> <player-cache.json> <output.js>");
    process.exit(1);
}

const parseCsv = (source) => {
    const rows = [];
    let row = [], value = "", quoted = false;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (quoted) {
            if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
            else if (character === '"') quoted = false;
            else value += character;
        } else if (character === '"') quoted = true;
        else if (character === ",") { row.push(value); value = ""; }
        else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
        else value += character;
    }
    if (value || row.length) { row.push(value); rows.push(row); }
    const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, ""));
    return rows.filter((item) => item.length > 1).map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""])));
};

const schedule = JSON.parse(fs.readFileSync(scheduleFile, "utf8"));
const players = JSON.parse(fs.readFileSync(playerCacheFile, "utf8")).players || {};
const pitchingStats = pitchingStatsFile ? JSON.parse(fs.readFileSync(pitchingStatsFile, "utf8")) : null;
const totalPitches = (pitchingStats?.stats?.[0]?.splits || []).reduce((total, split) => total + Number(split.stat?.numberOfPitches || 0), 0);
const totalCalledPitches = calledPitchesFile
    ? parseCsv(fs.readFileSync(calledPitchesFile, "utf8")).reduce((total, row) => total + Number(row.pitches || 0), 0)
    : 0;
if (peopleFile) for (const person of JSON.parse(fs.readFileSync(peopleFile, "utf8")).people || []) {
    players[person.id] = { ...players[person.id], fullName: person.fullName, position: person.primaryPosition?.abbreviation || players[person.id]?.position };
}
const games = new Map();
for (const date of schedule.dates || []) for (const game of date.games || []) {
    const umpire = (game.officials || []).find((official) => official.officialType === "Home Plate")?.official;
    games.set(Number(game.gamePk), {
        homeTeamId: Number(game.teams?.home?.team?.id),
        awayTeamId: Number(game.teams?.away?.team?.id),
        umpireId: Number(umpire?.id) || null,
        umpire: umpire?.fullName || "—"
    });
}

const number = (value) => Number(value);
const summaries = {
    ballToStrike: { batter: new Map(), pitcher: new Map() },
    strikeToBall: { batter: new Map(), pitcher: new Map() }
};

const distanceFromEdgeCm = (row, callType) => {
    const x = Math.abs(number(row.plate_x));
    const z = number(row.plate_z);
    const top = number(row.sz_top);
    const bottom = number(row.sz_bot);
    if (![x, z, top, bottom].every(Number.isFinite)) return 0;
    const horizontal = 0.83;
    if (callType === "ballToStrike") {
        const dx = Math.max(x - horizontal, 0);
        const dz = Math.max(bottom - z, z - top, 0);
        return Math.hypot(dx, dz) * 30.48;
    }
    return Math.max(0, Math.min(horizontal - x, z - bottom, top - z)) * 30.48;
};

const add = (map, row, role, callType) => {
    const game = games.get(number(row.game_pk));
    if (!game) return;
    const playerId = number(row[role]);
    if (!playerId) return;
    const batting = String(row.inning_topbot).toLowerCase() === "top";
    const battingTeamId = batting ? game.awayTeamId : game.homeTeamId;
    const fieldingTeamId = batting ? game.homeTeamId : game.awayTeamId;
    const teamId = role === "batter" ? battingTeamId : fieldingTeamId;
    const profile = players[playerId] || {};
    const summary = map.get(playerId) || {
        playerId,
        name: profile.fullName || `Player ${playerId}`,
        position: profile.position || (role === "pitcher" ? "P" : "—"),
        teamId,
        calls: 0,
        impact: 0,
        maxDistanceCm: 0,
        umpires: {}
    };
    summary.calls += 1;
    summary.impact += callType === "ballToStrike" ? (number(row.strikes) === 2 ? 1 : 0) : (number(row.balls) === 3 ? 1 : 0);
    summary.maxDistanceCm = Math.max(summary.maxDistanceCm, distanceFromEdgeCm(row, callType));
    if (game.umpireId) {
        const key = String(game.umpireId);
        const umpire = summary.umpires[key] || { umpireId: game.umpireId, umpire: game.umpire, count: 0 };
        umpire.count += 1;
        summary.umpires[key] = umpire;
    }
    map.set(playerId, summary);
};

const processRows = (file, callType) => {
    for (const row of parseCsv(fs.readFileSync(file, "utf8"))) {
        add(summaries[callType].batter, row, "batter", callType);
        add(summaries[callType].pitcher, row, "pitcher", callType);
    }
};
processRows(outsideStrikeFile, "ballToStrike");
processRows(insideBallFile, "strikeToBall");

const finalize = (map) => [...map.values()].map((row) => {
    const [topUmpire = { umpireId: null, umpire: "—", count: 0 }] = Object.values(row.umpires)
        .sort((a, b) => b.count - a.count || a.umpire.localeCompare(b.umpire));
    const { umpires, ...summary } = row;
    return { ...summary, topUmpireId: topUmpire.umpireId, topUmpire: topUmpire.umpire, topUmpireCount: topUmpire.count };
}).sort((a, b) => b.calls - a.calls || b.impact - a.impact || a.name.localeCompare(b.name));

const leaderboards = Object.fromEntries(Object.entries(summaries).map(([callType, roles]) => [
    callType,
    Object.fromEntries(Object.entries(roles).map(([role, map]) => [role, finalize(map)]))
]));
const output = { _meta: { totalPitches, totalCalledPitches }, ...leaderboards };
fs.writeFileSync(outputFile, `window.ABILITIES_MISSED_CALLS_2026 = ${JSON.stringify(output)};\n`);
console.log(`Wrote missed-call data: ${Object.values(leaderboards).flatMap((roles) => Object.values(roles)).reduce((sum, rows) => sum + rows.length, 0)} leaderboard rows.`);
