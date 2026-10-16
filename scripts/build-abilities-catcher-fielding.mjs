import fs from "node:fs";

const sourcePath = process.argv[2];
const outputPath = process.argv[3] || "js/abilities-catcher-fielding-data-2026.js";

if (!sourcePath) {
    throw new Error("Usage: node scripts/build-abilities-catcher-fielding.mjs <statsapi-json> [output-js]");
}

const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const splits = (payload.stats?.[0]?.splits || [])
    .filter(({ position }) => position?.abbreviation === "C");
const rows = splits.map(({ player, stat }) => {
    const caughtStealing = Number(stat.caughtStealing || 0);
    const stolenBases = Number(stat.stolenBases || 0);
    const attempts = caughtStealing + stolenBases;
    return {
        playerId: player.id,
        caughtStealing,
        stolenBases,
        attempts,
        caughtStealingRate: attempts ? caughtStealing / attempts : null
    };
}).sort((a, b) => a.playerId - b.playerId);

const output = `// 2026 MLB StatsAPI catcher fielding data.\n// Generated 2026-10-17; caught stealing rate = caught stealing / (caught stealing + stolen bases).\nwindow.ABILITIES_CATCHER_FIELDING_2026 = ${JSON.stringify(rows)};\n`;
fs.writeFileSync(outputPath, output);
console.log(`Wrote ${rows.length} catcher rows to ${outputPath}`);
