import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "js/mlb-prospect-rankings.js");
const sourceUrl = "https://www.mlb.com/milb/prospects/top100";

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`MLB Pipeline Top 100: HTTP ${response.status}`);
const html = await response.text();
const encodedState = html.match(/data-init-state="([^"]*prospects-production[^"]*)"/)?.[1];
if (!encodedState) throw new Error("MLB Pipeline Top 100の順位データが見つかりません");

const state = JSON.parse(encodedState
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">"));
const rootQuery = state?.payload?.ROOT_QUERY ?? {};
const rankingsKey = Object.keys(rootQuery)
    .find((key) => key.startsWith("getPlayerRankingsFromSelection"));
const rankings = (rootQuery[rankingsKey] ?? []).flatMap((entry) => {
    const reference = entry?.playerEntity?.player?.__ref ?? "";
    const playerId = Number(reference.match(/^Person:(\d+)$/)?.[1]);
    const rank = Number(entry?.rank);
    if (!Number.isInteger(playerId) || !Number.isInteger(rank)) return [];
    return [{ playerId, rank }];
});
if (rankings.length < 75) throw new Error(`Top 100の取得件数が不足しています: ${rankings.length}`);

const generatedAt = new Date().toISOString();
const output = `// MLB Pipeline Top 100から自動生成。手動編集しないでください。\n` +
`(function (global) {\n` +
`    global.MLB_PROSPECT_RANKINGS = Object.freeze({\n` +
rankings.map(({ playerId, rank }) => `        ${playerId}: ${rank}`).join(",\n") +
`\n    });\n` +
`    global.MLB_PROSPECT_RANKINGS_META = Object.freeze({ source: ${JSON.stringify(sourceUrl)}, updatedAt: ${JSON.stringify(generatedAt)} });\n` +
`})(window);\n`;

await writeFile(outputPath, output);
console.log(`MLB Pipeline Top 100を${rankings.length}人分更新: ${outputPath}`);
