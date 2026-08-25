#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORDS = path.join(ROOT, "data", "records");
const BACKFILL = path.join(RECORDS, "backfill");
const INCLUDED_NAMES = new Map([
    [119534, "村上 雅則"], [116855, "柏田 貴史"], [219594, "大家 友和"],
    [408193, "石井 一久"], [425781, "マイケル 中村"], [493131, "小林 雅英"]
]);
const EXCLUDED_IDS = new Set([112252, 118623]);
const YEARS = Array.from({ length: 63 }, (_, index) => 1964 + index);

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const atomicWrite = async (file, value) => {
    const temporary = `${file}.tmp-${process.pid}`;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    JSON.parse(json);
    await fs.writeFile(temporary, json, "utf8");
    await fs.rename(temporary, file);
};

let audited = 0;
let excluded = 0;
let renamed = 0;
for (let year = 1964; year <= 2021; year += 1) {
    const archivePath = path.join(BACKFILL, `${year}.json`);
    const reportPath = path.join(BACKFILL, `${year}-build-report.json`);
    const records = await readJson(archivePath);
    records.forEach((record) => {
        if (!record.isJapanesePlayer) return;
        audited += 1;
        const id = Number(record.playerId);
        if (EXCLUDED_IDS.has(id)) {
            record.isJapanesePlayer = false;
            if (record.category === "japanese") record.category = "individual";
            excluded += 1;
            return;
        }
        const japaneseName = INCLUDED_NAMES.get(id);
        if (japaneseName && record.playerName !== japaneseName) {
            record.playerName = japaneseName;
            renamed += 1;
        }
    });
    await atomicWrite(archivePath, records);
    const report = await readJson(reportPath);
    report.japaneseRecords = records.filter((record) => record.isJapanesePlayer).length;
    await atomicWrite(reportPath, report);
}

const archives = YEARS.map((year) => ({
    year,
    path: year <= 2021 ? `backfill/${year}.json` : `${year}.json`
}));
await atomicWrite(path.join(RECORDS, "index.json"), {
    startDate: "1964-01-01",
    endDate: "2026-12-31",
    years: YEARS,
    archives
});

console.log(JSON.stringify({ audited, excluded, renamed, years: YEARS.length }, null, 2));
