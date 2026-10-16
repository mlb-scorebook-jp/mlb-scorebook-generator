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
        challengesByTeam: {}
    };
    const overturned = Number(challenge.is_challengeABS_overturned) === 1;
    summary.challenges += 1;
    summary.overturned += overturned ? 1 : 0;
    summary.maxEdgeDistance = Math.max(summary.maxEdgeDistance, Math.abs(Number(challenge.edge_dist_calc) || 0));
    const challengerId = Number(challenge.challenging_player_id);
    const battingTeam = challengerId === Number(challenge.player_at_bat);
    const teamId = Number(battingTeam ? challenge.bat_team_id : challenge.fld_team_id);
    const team = battingTeam ? challenge.bat_team_abbr : challenge.fld_team_abbr;
    if (teamId && team) {
        const teamKey = String(teamId);
        const previous = summary.challengesByTeam[teamKey] || { teamId, team, challenges: 0, won: 0 };
        previous.challenges += 1;
        previous.won += overturned ? 1 : 0;
        summary.challengesByTeam[teamKey] = previous;
    }
    summaries.set(umpire.id, summary);
}

const rows = [...summaries.values()]
    .map((row) => {
        const [topTeam = { teamId: null, team: "—", challenges: 0, won: 0 }] = Object.values(row.challengesByTeam)
            .sort((a, b) => b.won - a.won || b.challenges - a.challenges || a.team.localeCompare(b.team));
        const { challengesByTeam, ...summary } = row;
        return {
            ...summary,
            overturnRate: row.overturned / row.challenges,
            topTeamId: topTeam.teamId,
            topTeam: topTeam.team,
            topTeamWon: topTeam.won,
            topTeamChallenges: topTeam.challenges
        };
    })
    .sort((a, b) => b.overturnRate - a.overturnRate || b.challenges - a.challenges || a.name.localeCompare(b.name));

const source = `window.ABILITIES_ABS_UMPIRES_2026 = ${JSON.stringify(rows)};\n`;
fs.writeFileSync(outputFile, source);
console.log(`Wrote ${rows.length} umpires from ${uniqueChallenges.size} ABS challenges.`);
