import fs from "node:fs";
import path from "node:path";

const [detailsDirectory, scheduleFile, outputFile] = process.argv.slice(2);

if (!detailsDirectory || !scheduleFile || !outputFile) {
    console.error("Usage: node build-abilities-abs-umpires.mjs <details-dir> <schedule.json> <output.js>");
    process.exit(1);
}

const schedule = JSON.parse(fs.readFileSync(scheduleFile, "utf8"));
const homePlateUmpires = new Map();

for (const date of schedule.dates || []) {
    for (const game of date.games || []) {
        const umpire = (game.officials || []).find((official) => official.officialType === "Home Plate")?.official;
        if (umpire) homePlateUmpires.set(Number(game.gamePk), umpire);
    }
}

const uniqueChallenges = new Map();
for (const file of fs.readdirSync(detailsDirectory).filter((name) => name.endsWith(".json"))) {
    const payload = JSON.parse(fs.readFileSync(path.join(detailsDirectory, file), "utf8"));
    for (const challenge of payload.data || []) {
        if (challenge.play_id && !uniqueChallenges.has(challenge.play_id)) {
            uniqueChallenges.set(challenge.play_id, challenge);
        }
    }
}

const summaries = new Map();
for (const challenge of uniqueChallenges.values()) {
    const umpire = homePlateUmpires.get(Number(challenge.game_pk));
    if (!umpire) continue;

    const summary = summaries.get(umpire.id) || {
        name: umpire.fullName,
        umpireId: umpire.id,
        challenges: 0,
        overturned: 0,
        overturnRate: 0,
        maxEdgeDistance: 0,
        strikeoutChanges: 0,
        walkChanges: 0
    };
    const overturned = Number(challenge.is_challengeABS_overturned) === 1;
    summary.challenges += 1;
    summary.overturned += overturned ? 1 : 0;
    summary.maxEdgeDistance = Math.max(summary.maxEdgeDistance, Math.abs(Number(challenge.edge_dist_calc) || 0));
    if (overturned && Number(challenge.pre_strike_count) === 2) summary.strikeoutChanges += 1;
    if (overturned && Number(challenge.pre_ball_count) === 3) summary.walkChanges += 1;
    summaries.set(umpire.id, summary);
}

const rows = [...summaries.values()]
    .map((row) => ({ ...row, overturnRate: row.overturned / row.challenges }))
    .sort((a, b) => b.overturnRate - a.overturnRate || b.challenges - a.challenges || a.name.localeCompare(b.name));

const source = `window.ABILITIES_ABS_UMPIRES_2026 = ${JSON.stringify(rows)};\n`;
fs.writeFileSync(outputFile, source);
console.log(`Wrote ${rows.length} umpires from ${uniqueChallenges.size} ABS challenges.`);
