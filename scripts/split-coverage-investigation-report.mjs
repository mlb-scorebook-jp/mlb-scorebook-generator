#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recordsDirectory = path.join(ROOT, "data", "records");
const reportPath = path.join(recordsDirectory, "coverage-investigation-report.json");
const auditDirectory = path.join(recordsDirectory, "coverage-audits");

const atomicWrite = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    JSON.parse(json);
    await fs.writeFile(temporary, json, "utf8");
    await fs.rename(temporary, file);
};

const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
if (!Array.isArray(report.years) || report.years.length === 0) {
    throw new Error("分割対象のyearsがありません。");
}

const years = [...report.years].sort((a, b) => Number(a.year) - Number(b.year));
if (new Set(years.map((entry) => Number(entry.year))).size !== years.length) {
    throw new Error("coverage監査年が重複しています。");
}

for (const year of years) {
    if (!Number.isInteger(Number(year.year)) || !Array.isArray(year.samples)) {
        throw new Error(`不正な年次監査データです: ${year.year}`);
    }
    await atomicWrite(path.join(auditDirectory, `${year.year}.json`), year);
}

const manifest = {
    schemaVersion: 2,
    generatedAt: report.generatedAt,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    apiRequests: report.apiRequests,
    yearsRequested: report.yearsRequested,
    auditMode: report.auditMode,
    samplesPerYear: report.samplesPerYear,
    concurrency: report.concurrency,
    requirements: report.requirements,
    yearFiles: years.map((year) => ({
        year: Number(year.year),
        path: `coverage-audits/${year.year}.json`,
        auditMode: year.auditMode,
        scheduleGames: Number(year.schedule?.games || 0),
        sampleCount: year.samples.length
    }))
};

await atomicWrite(reportPath, manifest);
console.log(`coverage監査を${years.length}年分に分割しました。`);
