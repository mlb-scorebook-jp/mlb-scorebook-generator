import fs from "node:fs";

const sourcePath = process.argv[2];
const popTimePath = process.argv[3];
const outputPath = process.argv[4] || "js/abilities-catcher-fielding-data-2026.js";

if (!sourcePath || !popTimePath) {
    throw new Error("Usage: node scripts/build-abilities-catcher-fielding.mjs <statsapi-json> <poptime-csv> [output-js]");
}

const parseCsvLine = (line) => {
    const values = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') quoted = !quoted;
        else if (character === "," && !quoted) { values.push(value); value = ""; }
        else value += character;
    }
    values.push(value);
    return values;
};

const popTimeLines = fs.readFileSync(popTimePath, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
const popTimeHeaders = parseCsvLine(popTimeLines.shift());
const popTimeByPlayerId = new Map(popTimeLines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(popTimeHeaders.map((header, index) => [header, values[index]]));
    return [Number(row.entity_id), row];
}));

const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const splits = (payload.stats?.[0]?.splits || [])
    .filter(({ position }) => position?.abbreviation === "C");
const rows = splits.map(({ player, stat }) => {
    const caughtStealing = Number(stat.caughtStealing || 0);
    const stolenBases = Number(stat.stolenBases || 0);
    const attempts = caughtStealing + stolenBases;
    const popTime = popTimeByPlayerId.get(player.id) || {};
    const numberOrNull = (value) => value === "" || value == null ? null : Number(value);
    return {
        playerId: player.id,
        caughtStealing,
        stolenBases,
        attempts,
        caughtStealingRate: attempts ? caughtStealing / attempts : null,
        catcherArmStrength: numberOrNull(popTime.maxeff_arm_2b_3b_sba),
        exchangeTime: numberOrNull(popTime.exchange_2b_3b_sba),
        popTime2b: numberOrNull(popTime.pop_2b_sba),
        popTime2bAttempts: numberOrNull(popTime.pop_2b_sba_count)
    };
}).sort((a, b) => a.playerId - b.playerId);

const output = `// 2026 MLB StatsAPI catcher fielding data enriched with Baseball Savant Pop Time metrics.\n// Generated 2026-10-17; caught stealing rate = caught stealing / (caught stealing + stolen bases).\nwindow.ABILITIES_CATCHER_FIELDING_2026 = ${JSON.stringify(rows)};\n`;
fs.writeFileSync(outputPath, output);
console.log(`Wrote ${rows.length} catcher rows to ${outputPath}`);
