import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";

const trackerSeason = Number(process.argv[2] || new Date().getFullYear() + 1);
const inputPath = process.argv[3];
const trackerUrl = `https://www.fangraphs.com/roster-resource/free-agent-tracker?season=${trackerSeason}`;
const html = inputPath
    ? await readFile(resolve(inputPath), "utf8")
    : await fetch(trackerUrl).then((response) => {
        if (!response.ok) throw new Error(`FanGraphs: HTTP ${response.status}`);
        return response.text();
    });
const nextDataText = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
)?.[1];
if (!nextDataText) throw new Error("FanGraphsのFAデータを読み取れませんでした。");

const nextData = JSON.parse(nextDataText);
const query = nextData.props.pageProps.dehydratedState.queries.find((item) =>
    String(item.queryKey?.[0]).includes("free-agent-tracker/data")
);
const contracts = (query?.state?.data ?? [])
    .filter((entry) =>
        entry.playerName && entry.team_new &&
        Number(entry.contract_years) > 0 && Number(entry.ContractTotal) > 0
    )
    .map((entry) => ({
        name: entry.playerName,
        years: Number(entry.contract_years),
        tenThousands: Math.round(Number(entry.ContractTotal) / 10000)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
if (contracts.length === 0) {
    throw new Error("FanGraphsから有効なFA契約を取得できませんでした。既存データは保持します。");
}

const season = trackerSeason - 1;
const outputPath = resolve("js/free-agent-contracts.js");
const existingText = await readFile(outputPath, "utf8").catch(() => "");
const existingContext = { window: {} };
if (existingText) vm.runInNewContext(existingText, existingContext);
const contractsBySeason = {
    ...(existingContext.window.MLB_FREE_AGENT_CONTRACTS || {}),
    [season]: contracts
};
const serializedSeasons = Object.entries(contractsBySeason)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([year, seasonContracts]) => {
        const serializedContracts = JSON.stringify(seasonContracts, null, 4)
            .split("\n")
            .map((line) => `            ${line}`)
            .join("\n");
        return `        ${year}: Object.freeze(${serializedContracts.trimStart()})`;
    })
    .join(",\n");
const output = `// FanGraphs Free Agent Trackerから取得した契約条件。\n` +
`// Source: ${trackerUrl}\n` +
`(function (global) {\n` +
`    global.MLB_FREE_AGENT_CONTRACTS = Object.freeze({\n` +
`${serializedSeasons}\n` +
`    });\n` +
`})(window);\n`;

await writeFile(outputPath, output);
const cacheKey = createHash("sha256").update(output).digest("hex").slice(0, 12);
const indexPath = resolve("index.html");
const indexHtml = await readFile(indexPath, "utf8");
const versionedIndex = indexHtml.replace(
    /js\/free-agent-contracts\.js\?v=[^"\s]+/,
    `js/free-agent-contracts.js?v=${cacheKey}`
);
if (versionedIndex !== indexHtml) await writeFile(indexPath, versionedIndex);
console.log(`${contracts.length}件の契約条件を更新しました。`);
