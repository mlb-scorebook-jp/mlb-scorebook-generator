import fs from "node:fs";

const sourceFiles = {
    al: "/tmp/mlb-algg-all.json",
    nl: "/tmp/mlb-nlgg-all.json"
};
const playersSource = fs.readFileSync(new URL("../js/players.js", import.meta.url), "utf8");
const namesMatch = playersSource.match(/const NHK_PLAYER_NAMES = (\{.*?\});/s);
const japaneseNames = namesMatch ? JSON.parse(namesMatch[1]) : {};
const normalizeName = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const positionOrder = { P: 0, C: 1, "1B": 2, "2B": 3, SS: 4, "3B": 5, LF: 6, CF: 7, RF: 8, OF: 9, UT: 10 };
const seasons = {};

for (const [league, path] of Object.entries(sourceFiles)) {
    const awards = JSON.parse(fs.readFileSync(path, "utf8")).awards || [];
    for (const award of awards) {
        const season = Number(award.season);
        if (season < 2007 || season > 2025) continue;
        const player = award.player || {};
        const team = award.team || {};
        const name = player.nameFirstLast || "";
        const row = {
            position: player.primaryPosition?.abbreviation || "—",
            player: name,
            playerJa: japaneseNames[normalizeName(name)] || name,
            playerId: player.id || null,
            team: team.abbreviation || "—",
            teamId: team.id || null
        };
        seasons[season] ||= { al: [], nl: [] };
        seasons[season][league].push(row);
    }
}

for (const season of Object.values(seasons)) {
    for (const league of ["al", "nl"]) {
        season[league].sort((a, b) => (positionOrder[a.position] ?? 99) - (positionOrder[b.position] ?? 99) || a.player.localeCompare(b.player));
    }
}

const output = `window.MLB_AWARDS_HISTORY = ${JSON.stringify(seasons, null, 2)};\n`;
fs.writeFileSync(new URL("../js/awards-history-2007-2025.js", import.meta.url), output);
