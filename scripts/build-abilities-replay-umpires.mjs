import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const [replayFile, scheduleFile, feedDirectory, outputFile] = process.argv.slice(2);
if (!replayFile || !scheduleFile || !feedDirectory || !outputFile) {
    console.error("Usage: node build-abilities-replay-umpires.mjs <replay.js> <schedule.json> <feed-dir> <output.js>");
    process.exit(1);
}

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(replayFile, "utf8"), context);
const replayRows = context.window.ABILITIES_REPLAY_2026 || [];
const schedule = JSON.parse(fs.readFileSync(scheduleFile, "utf8"));
const gamesByMatchup = new Map();

for (const date of schedule.dates || []) {
    for (const game of date.games || []) {
        const key = `${game.officialDate}|${game.teams.home.team.id}|${game.teams.away.team.id}`;
        const games = gamesByMatchup.get(key) || new Map();
        games.set(game.gamePk, game);
        gamesByMatchup.set(key, games);
    }
}

const playIdsByGame = new Map();
for (const file of fs.readdirSync(feedDirectory).filter((name) => /^replay-game-\d+\.json$/.test(name))) {
    const gamePk = Number(file.match(/\d+/)[0]);
    const feed = JSON.parse(fs.readFileSync(path.join(feedDirectory, file), "utf8"));
    const playIds = new Set();
    for (const play of feed.liveData?.plays?.allPlays || []) {
        for (const event of play.playEvents || []) if (event.playId) playIds.add(event.playId);
    }
    playIdsByGame.set(gamePk, playIds);
}

const officialTypeByReview = new Map([
    ["Close play at 1st", "First Base"],
    ["Hit by pitch", "Home Plate"],
    ["Catcher interference", "Home Plate"],
    ["Home-plate collision", "Home Plate"]
]);
const summaries = new Map();
let attributed = 0;

for (const replay of replayRows) {
    const officialType = officialTypeByReview.get(replay.type);
    if (!officialType) continue;

    const key = `${replay.date}|${replay.homeTeamId}|${replay.awayTeamId}`;
    const candidates = [...(gamesByMatchup.get(key)?.values() || [])];
    let game = candidates.length === 1 ? candidates[0] : candidates.find((candidate) => playIdsByGame.get(candidate.gamePk)?.has(replay.playId));
    if (!game) continue;

    const official = (game.officials || []).find((item) => item.officialType === officialType)?.official;
    if (!official) continue;

    const summary = summaries.get(official.id) || {
        name: official.fullName,
        umpireId: official.id,
        attempts: 0,
        overturned: 0,
        upheld: 0,
        upheldRate: 0,
        types: {}
    };
    const type = summary.types[replay.type] || { attempts: 0, overturned: 0, upheld: 0 };
    summary.attempts += 1;
    summary.overturned += replay.overturned ? 1 : 0;
    summary.upheld += replay.overturned ? 0 : 1;
    type.attempts += 1;
    type.overturned += replay.overturned ? 1 : 0;
    type.upheld += replay.overturned ? 0 : 1;
    summary.types[replay.type] = type;
    summaries.set(official.id, summary);
    attributed += 1;
}

const topType = (types, key) => {
    const top = Object.entries(types)
        .sort((a, b) => b[1][key] - a[1][key] || b[1].attempts - a[1].attempts || a[0].localeCompare(b[0]))[0];
    return top?.[1]?.[key] > 0 ? top[0] : "—";
};

const rows = [...summaries.values()].map((row) => {
    const { types, ...summary } = row;
    return {
        ...summary,
        upheldRate: row.upheld / row.attempts,
        mostOverturnedType: topType(types, "overturned"),
        mostUpheldType: topType(types, "upheld")
    };
}).sort((a, b) => b.upheldRate - a.upheldRate || b.attempts - a.attempts || a.name.localeCompare(b.name));

fs.writeFileSync(outputFile, `// ${attributed} directly attributable replay reviews.\nwindow.ABILITIES_REPLAY_UMPIRES_2026 = ${JSON.stringify(rows)};\n`);
console.log(`Wrote ${rows.length} umpires from ${attributed} directly attributable replay reviews.`);
