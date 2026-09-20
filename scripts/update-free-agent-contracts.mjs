import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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

const season = trackerSeason - 1;
const serializedContracts = JSON.stringify(contracts, null, 4)
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n");
const output = `// FanGraphs Free Agent Trackerから取得した契約条件。\n` +
`// Source: ${trackerUrl}\n` +
`(function (global) {\n` +
`    global.MLB_FREE_AGENT_CONTRACTS = Object.freeze({\n` +
`        ${season}: Object.freeze(${serializedContracts.trimStart()})\n` +
`    });\n` +
`})(window);\n`;

await writeFile(resolve("js/free-agent-contracts.js"), output);
console.log(`${contracts.length}件の契約条件を更新しました。`);
