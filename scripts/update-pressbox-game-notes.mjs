#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const pdfjsLib = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "data", "pressbox", "game-notes.js");
const PROFILE = process.env.MLB_PRESSBOX_PROFILE || path.join(ROOT, ".pressbox-profile");
const BROWSER_EXECUTABLE = process.env.MLB_PRESSBOX_BROWSER ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ARCHIVE_URL = "https://pressbox.mlb.com/archive/game-notes";
const API_ROOT = "https://statsapi.mlb.com/api/v1";
const targetDate = process.argv[2] || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("日付は YYYY-MM-DD 形式で指定してください。");
}

const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
const [, month, day] = targetDate.split("-").map(Number);
const archiveDate = `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${targetDate.slice(0, 4)}`;

const fetchJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
};

const loadExisting = async () => {
    try {
        const source = await fs.readFile(OUTPUT, "utf8");
        const sandbox = { window: {} };
        vm.runInNewContext(source, sandbox, { timeout: 1000 });
        return sandbox.window.MLB_PRESSBOX_GAME_NOTES ?? {};
    } catch {
        return {};
    }
};

const extractPdfText = async (bytes) => {
    const document = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(" ").replace(/\s+/g, " "));
    }
    return pages;
};

const sentenceAround = (text, index) => {
    const start = Math.max(text.lastIndexOf(".", index - 1) + 1, index - 180, 0);
    const next = text.indexOf(".", index);
    return text.slice(start, next < 0 ? index + 220 : next + 1).trim();
};

const candidateItems = (pages, document) => {
    const patterns = [
        { regex: /(\d+)[- ]game hitting streak/ig, label: (n) => `${n}試合連続安打中` },
        { regex: /(\d+)[- ]game on-base streak/ig, label: (n) => `${n}試合連続出塁中` },
        { regex: /(\d+)[- ]game RBI streak/ig, label: (n) => `${n}試合連続打点中` },
        { regex: /(\d+)[- ]game home run streak/ig, label: (n) => `${n}試合連続本塁打中` },
        { regex: /(\d+(?:\.\d+)?)[- ](?:consecutive )?scoreless innings/ig, label: (n) => `${n}イニング連続無失点中` }
    ];
    const items = [];
    pages.forEach((pageText, pageIndex) => {
        patterns.forEach(({ regex, label }) => {
            regex.lastIndex = 0;
            for (const match of pageText.matchAll(regex)) {
                const evidence = sentenceAround(pageText, match.index ?? 0);
                const subject = evidence.match(/(?:^|\.\s+)([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2})\s+(?:has|is|enters|owns|extended)/i)?.[1];
                items.push({
                    text: `${subject ? `${subject}は` : `${document.teamCode}は`}${label(match[1])}。`,
                    href: `${document.href}#page=${pageIndex + 1}`,
                    page: String(pageIndex + 1),
                    evidence
                });
                if (items.length >= 8) return;
            }
        });
    });
    if (!items.length) {
        items.push({
            text: `${document.teamCode}の試合前ゲームノートを取得済み。`,
            href: document.href,
            page: "1",
            evidence: document.title
        });
    }
    return items;
};

const schedule = await fetchJson(`${API_ROOT}/schedule?sportId=1&date=${targetDate}&hydrate=team`);
const games = (schedule.dates ?? []).flatMap((entry) => entry.games ?? []);
if (!games.length) throw new Error(`${targetDate}のMLB試合が見つかりません。`);

await fs.mkdir(PROFILE, { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: BROWSER_EXECUTABLE,
    headless: false,
    viewport: { width: 1440, height: 960 }
});
const page = context.pages()[0] || await context.newPage();
await page.goto(ARCHIVE_URL, { waitUntil: "domcontentloaded" });
if (!page.url().includes("/archive/game-notes")) {
    console.log("Pressboxへログインしてください。ログイン後は自動的に続行します。");
    await page.waitForURL(/\/archive\/game-notes/, { timeout: 300_000 });
}

const selectByLabel = async (selector, label) => {
    const select = page.locator(selector);
    if (!await select.count()) return;
    const option = select.locator("option").filter({ hasText: label }).first();
    if (await option.count()) await select.selectOption(await option.getAttribute("value"));
};
await selectByLabel("#month-select", monthNames[month - 1]);
await selectByLabel("#year-input", targetDate.slice(0, 4));
await page.waitForTimeout(1500);

const archiveEntries = [];
for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    archiveEntries.push(...await page.locator('a[href*="img.mlbstatic.com"][href*=".pdf"]').evaluateAll((links) =>
        links.map((link) => {
            const row = link.closest("tr") || link.parentElement?.parentElement || link.parentElement;
            const image = row?.querySelector('img[alt*="team-id-"]');
            const date = row?.innerText?.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || "";
            return {
                title: link.textContent?.trim() || "Game Notes",
                href: link.href.replace("/fl_attachment/", "/"),
                teamId: Number(image?.alt?.match(/team-id-(\d+)/)?.[1] || 0),
                date
            };
        })
    ));
    const next = page.getByRole("button", { name: /^next$/i });
    if (!await next.count() || await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(900);
}
await context.close();

const sameDay = archiveEntries.filter((entry) => entry.date === archiveDate && entry.teamId &&
    !/(postgame|season in review|year in review)/i.test(entry.title));
const result = {};
for (const game of games) {
    const teams = [game.teams?.away?.team, game.teams?.home?.team].filter(Boolean);
    const documents = teams.flatMap((team) => sameDay
        .filter((entry) => entry.teamId === Number(team.id))
        .slice(0, 1)
        .map((entry) => ({ ...entry, teamCode: team.abbreviation || team.name })));
    const items = [];
    for (const document of documents) {
        try {
            const response = await fetch(document.href);
            if (!response.ok) throw new Error(String(response.status));
            const pages = await extractPdfText(await response.arrayBuffer());
            items.push(...candidateItems(pages, document));
        } catch (error) {
            items.push({
                text: `${document.teamCode}の試合前ゲームノートを取得済み（本文解析失敗）。`,
                href: document.href,
                page: "1",
                evidence: String(error)
            });
        }
    }
    if (documents.length) result[String(game.gamePk)] = { date: targetDate, documents, items };
}

const existing = await loadExisting();
Object.keys(existing).forEach((gamePk) => {
    if (existing[gamePk]?.date === targetDate) delete existing[gamePk];
});
Object.assign(existing, result);
await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT,
    `"use strict";\n\nwindow.MLB_PRESSBOX_GAME_NOTES = ${JSON.stringify(existing, null, 4)};\n`, "utf8");

console.log(`${targetDate}: ${games.length}試合中${Object.keys(result).length}試合、${Object.values(result).reduce((sum, game) => sum + game.documents.length, 0)}件のゲームノートを保存しました。`);
