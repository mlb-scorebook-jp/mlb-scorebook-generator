import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPHQL_URL = "https://data-graph.mlb.com/graphql";
const NEWS_PATH = "sel-mlb-news-list?$limit=30";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "js/mlb-latest-news.js");
const playerNamesPath = resolve(root, "js/players.js");

const normalizeName = (value) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const playerNamesSource = await readFile(playerNamesPath, "utf8");
const playerNamesStart = playerNamesSource.indexOf("{");
const playerNamesEnd = playerNamesSource.lastIndexOf("};");
if (playerNamesStart < 0 || playerNamesEnd < playerNamesStart) {
    throw new Error("NHK player-name table could not be read");
}
const playerNames = JSON.parse(playerNamesSource.slice(playerNamesStart, playerNamesEnd + 1));
const newsPlayerNameOverrides = new Map([
    ["tommyjohn", "T.ジョン"]
]);

const teamNames = new Map([
    [108, ["エンゼルス", "LAA"]], [109, ["ダイヤモンドバックス", "AZ"]],
    [110, ["オリオールズ", "BAL"]], [111, ["レッドソックス", "BOS"]],
    [112, ["カブス", "CHC"]], [113, ["レッズ", "CIN"]],
    [114, ["ガーディアンズ", "CLE"]], [115, ["ロッキーズ", "COL"]],
    [116, ["タイガース", "DET"]], [117, ["アストロズ", "HOU"]],
    [118, ["ロイヤルズ", "KC"]], [119, ["ドジャース", "LAD"]],
    [120, ["ナショナルズ", "WSH"]], [121, ["メッツ", "NYM"]],
    [133, ["アスレチックス", "ATH"]], [134, ["パイレーツ", "PIT"]],
    [135, ["パドレス", "SD"]], [136, ["マリナーズ", "SEA"]],
    [137, ["ジャイアンツ", "SF"]], [138, ["カージナルス", "STL"]],
    [139, ["レイズ", "TB"]], [140, ["レンジャーズ", "TEX"]],
    [141, ["ブルージェイズ", "TOR"]], [142, ["ツインズ", "MIN"]],
    [143, ["フィリーズ", "PHI"]], [144, ["ブレーブス", "ATL"]],
    [145, ["ホワイトソックス", "CWS"]], [146, ["マーリンズ", "MIA"]],
    [147, ["ヤンキース", "NYY"]], [158, ["ブルワーズ", "MIL"]]
]);

const query = `
query Latest($path:String!,$language:Language,$source:ContentSource){
  items:getContentListFromPath(path:$path,language:$language,source:$source){
    ... on Article{
      headline slug contentDate relativeSiteUrl
      tags{
        __typename
        ... on TeamTag{team{id name}}
        ... on PersonTag{person{id fullName}}
        ... on TaxonomyTag{slug}
      }
    }
  }
}`;

const japaneseSummaries = new Map([
    ["shohei-ohtani-plays-catch-in-knee-injury-recovery",
        "大谷翔平（LAD）がキャッチボールを再開。レギュラーシーズン中の投手復帰の可能性を残している。"],
    ["max-scherzer-enters-top-10-all-time-strikeout-leaderboard",
        "M.シャーザー（TOR）が通算3516奪三振に到達し、MLB歴代10位へ浮上した。"]
]);

const officialUrl = (relativeSiteUrl, slug) => {
    const candidate = relativeSiteUrl || `/news/${slug}`;
    const parsed = new URL(candidate, "https://www.mlb.com");
    if (parsed.protocol !== "https:" ||
        !(parsed.hostname === "mlb.com" || parsed.hostname.endsWith(".mlb.com"))) {
        throw new Error(`Unexpected MLB article URL: ${parsed.href}`);
    }
    return parsed.href;
};

const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        query,
        variables: { path: NEWS_PATH, language: "EN_US", source: "MLB" }
    })
});
if (!response.ok) throw new Error(`MLB news request failed: ${response.status}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(payload.errors[0]?.message || "MLB GraphQL error");

const articles = (payload.data?.items ?? []).map((article) => {
    const teams = article.tags
        ?.filter((tag) => tag.__typename === "TeamTag" && tag.team?.id)
        .map((tag) => ({ id: Number(tag.team.id), name: tag.team.name })) ?? [];
    const players = article.tags
        ?.filter((tag) => tag.__typename === "PersonTag" && tag.person?.id)
        .map((tag) => ({ id: Number(tag.person.id), name: tag.person.fullName })) ?? [];
    const taxonomy = article.tags
        ?.filter((tag) => tag.__typename === "TaxonomyTag" && tag.slug)
        .map((tag) => tag.slug) ?? [];
    const primaryTeam = teamNames.get(teams[0]?.id);
    const playerDisplayName = players[0]
        ? newsPlayerNameOverrides.get(normalizeName(players[0].name)) ||
            playerNames[normalizeName(players[0].name)] || players[0].name
        : "";
    const subject = playerDisplayName
        ? `${playerDisplayName}${primaryTeam ? `（${primaryTeam[1]}）` : ""}`
        : primaryTeam?.[0] || "MLBの最新情報";
    return {
        headline: article.headline,
        summaryJa: japaneseSummaries.get(article.slug) || `MLB公式が${subject}について報じた。`,
        slug: article.slug,
        url: officialUrl(article.relativeSiteUrl, article.slug),
        contentDate: article.contentDate,
        teamIds: teams.map((team) => team.id),
        playerIds: players.map((player) => player.id),
        taxonomy
    };
});

const source = `// MLB公式Latest Newsから自動生成。手動編集しないでください。\n` +
    `(function (global) {\n` +
    `    global.MLB_LATEST_NEWS = Object.freeze(${JSON.stringify(articles, null, 4)});\n` +
    `})(window);\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, source, "utf8");
console.log(`Updated ${articles.length} MLB official news articles.`);
