import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";

const readGlobal = async (path, globalName) => {
    const context = { window: {} };
    vm.runInNewContext(await readFile(resolve(path), "utf8"), context);
    return context.window[globalName] ?? {};
};

const news = await readGlobal("js/mlb-latest-news.js", "MLB_LATEST_NEWS");
const candidateSeasons = await readGlobal(
    "js/free-agent-candidates.js",
    "MLB_FREE_AGENT_CANDIDATES"
);
const candidatesById = new Map((candidateSeasons[2026] ?? [])
    .map((candidate) => [Number(candidate.playerId), candidate]));
const oldProgress = await readGlobal("js/free-agent-progress.js", "MLB_FREE_AGENT_PROGRESS");
const progress = structuredClone(oldProgress);
const mlbTeamIds = new Set([
    108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
    120, 121, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142,
    143, 144, 145, 146, 147, 158
]);

const articleDate = (value) => {
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(timestamp);
};

const parseTerms = (text) => {
    const yearWords = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10
    };
    const yearsMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})[- ]year\b/i);
    const moneyMatch = text.match(/\$([\d.]+)\s*(billion|million|[BM])\b/i);
    if (!yearsMatch || !moneyMatch) return {};
    const years = Number(yearsMatch[1]) || yearWords[yearsMatch[1].toLowerCase()];
    const amount = Number(moneyMatch[1]);
    const unit = moneyMatch[2].toLowerCase();
    if (!Number.isFinite(years) || !Number.isFinite(amount)) return {};
    return {
        years,
        tenThousands: Math.round(amount *
            (unit === "billion" || unit === "b" ? 100000 : 100))
    };
};

const officialArticle = (article) => {
    try {
        const host = new URL(article.url).hostname;
        return (host === "mlb.com" || host.endsWith(".mlb.com")) &&
            (article.sourceScopes ?? []).some((scope) =>
                scope === "MLB" || scope === "球団公式"
            );
    } catch {
        return false;
    }
};

for (const article of news) {
    if (!officialArticle(article)) continue;
    const headline = String(article.headline ?? "");
    const summary = String(article.summaryJa ?? "");
    const text = `${headline} ${summary}`;
    const date = articleDate(article.contentDate);
    if (!date) continue;

    for (const rawId of article.playerIds ?? []) {
        const playerId = Number(rawId);
        const candidate = candidatesById.get(playerId);
        if (!candidate) continue;
        const current = progress[playerId] ?? {};

        const explicitQO = /qualifying offer|\bQO\b/i.test(text);
        const QOIntent = /\b(?:will|would|plans? to|set to|intends? to|to)\s+(?:decline|reject|turn down)\b/i.test(text) ||
            /(?:拒否|断る|受けない)(?:方針|意向|予定)/.test(text);
        const QOReportedDecline = /\b(?:declined|rejected|turned down)\b/i.test(text) ||
            /QOを(?:拒否|断っ)た/.test(text);
        if (explicitQO && !current.qualifyingOffer?.verified && (QOIntent || QOReportedDecline)) {
            const statusText = QOReportedDecline
                ? "QO拒否（報道）"
                : /\b(?:likely|expected|probably)\b/i.test(text)
                    ? "QO拒否予想（報道）"
                    : "QO拒否方針（報道）";
            progress[playerId] = {
                ...current,
                qualifyingOffer: {
                    date,
                    statusText,
                    url: article.url,
                    source: "MLB/球団公式記事"
                }
            };
        }

        const extension = /\b(?:extension|extends?|extended|re-sign|resign)\b/i.test(headline);
        const agreementSignal = /\b(?:agrees? (?:to|on)|agreed (?:to|on)|in agreement (?:on|with)|signs? with|signed with)\b/i.test(headline) &&
            /\b(?:contract|deal|terms|year)\b/i.test(headline);
        if (!extension && agreementSignal) {
            const teams = [...new Set((article.teamIds ?? [])
                .map(Number).filter((id) => mlbTeamIds.has(id)))];
            const otherTeams = teams.filter((id) => id !== Number(candidate.teamId));
            const destinationTeamId = otherTeams.length === 1
                ? otherTeams[0]
                : teams.length === 1 ? teams[0] : 0;
            // 選手ID・移籍先球団の両方を記事タグで特定できる場合だけ反映。
            if (destinationTeamId) {
                progress[playerId] = {
                    ...progress[playerId],
                    agreement: {
                        teamId: destinationTeamId,
                        date,
                        ...(current.agreement?.years && current.agreement?.tenThousands
                            ? {
                                years: current.agreement.years,
                                tenThousands: current.agreement.tenThousands
                            }
                            : {}),
                        ...parseTerms(text),
                        url: article.url,
                        reported: true,
                        source: "MLB/球団公式記事"
                    }
                };
            }
        }
    }
}

const entries = Object.entries(progress)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([playerId, value]) => `        ${playerId}: Object.freeze(${JSON.stringify(value, null, 4)
        .split("\n").map((line, index) => index ? `            ${line}` : line).join("\n")})`)
    .join(",\n");
const output = `// MLB・各球団の公式記事から自動生成するFA進捗データ。\n` +
    `(function (global) {\n` +
    `    global.MLB_FREE_AGENT_PROGRESS = Object.freeze({\n${entries}\n    });\n` +
    `})(window);\n`;
await writeFile("js/free-agent-progress.js", output);

const indexPath = resolve("index.html");
const indexHtml = await readFile(indexPath, "utf8");
const cacheKey = createHash("sha256").update(output).digest("hex").slice(0, 12);
const newsSource = await readFile(resolve("js/mlb-latest-news.js"), "utf8");
const newsCacheKey = createHash("sha256").update(newsSource).digest("hex").slice(0, 12);
const versionedIndex = indexHtml
    .replace(
        /js\/mlb-latest-news\.js\?v=[^"\s]+/,
        `js/mlb-latest-news.js?v=${newsCacheKey}`
    )
    .replace(
    /js\/free-agent-progress\.js\?v=[^"\s]+/,
    `js/free-agent-progress.js?v=${cacheKey}`
    );
if (versionedIndex !== indexHtml) await writeFile(indexPath, versionedIndex);
console.log(`FA progress snapshot updated (${Object.keys(progress).length} players).`);
