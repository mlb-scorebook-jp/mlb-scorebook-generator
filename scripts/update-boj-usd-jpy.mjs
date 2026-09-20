import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const startMonth = process.argv[2] || "202401";
const now = new Date();
const endMonth = process.argv[3] ||
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const params = new URLSearchParams({
    format: "json",
    lang: "en",
    db: "FM08",
    startDate: startMonth,
    endDate: endMonth,
    code: "FXERD04"
});
const sourceUrl = `https://www.stat-search.boj.or.jp/api/v1/getDataCode?${params}`;
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`日本銀行API: HTTP ${response.status}`);
const payload = await response.json();
if (Number(payload?.STATUS) !== 200) {
    throw new Error(payload?.MESSAGE || "日本銀行APIからデータを取得できませんでした。");
}
const values = payload.RESULTSET?.[0]?.VALUES;
const rates = (values?.SURVEY_DATES ?? [])
    .map((surveyDate, index) => {
        const rawRate = values.VALUES?.[index];
        return {
            date: String(surveyDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
            rate: rawRate == null ? NaN : Number(rawRate)
        };
    })
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.rate));

const output = `// 日本銀行「東京市場 ドル・円 スポット 17時時点」（FXERD04）。\n` +
`// bid/offerの中間値。Source: https://www.stat-search.boj.or.jp/ssi/mtshtml/fxerd04.html\n` +
`(function (global) {\n` +
`    global.MLB_BOJ_USD_JPY = Object.freeze(${JSON.stringify(rates, null, 4)});\n` +
`})(window);\n`;
await writeFile(resolve("js/boj-usd-jpy.js"), output);
console.log(`${rates.length}営業日分のドル円レートを更新しました。`);
