import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createEvidencePdf, expectedPitchNumbers, hasCompleteCoverage, planPitchCaptures, sortEvidencePlays, validateSelectionAgainstPlay } from "./evidence/evidence-core.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.EVIDENCE_PORT) || 43123;
const jobs = new Map();
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Cache-Control": "no-store" };

const sendJson = (response, status, payload) => {
    response.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
};
const readJson = async (request) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};
const publicJob = (job) => ({
    id: job.id, status: job.status, message: job.message, totalCount: job.plays.length,
    completedCount: job.completedCount, manualReviewRequired: job.manualReviewRequired,
    downloadUrl: job.outputPath ? `/api/evidence/jobs/${job.id}/pdf` : "",
    items: job.items
});

const dismissOverlays = async (page) => {
    for (const name of [/accept/i, /agree/i, /同意/]) {
        const button = page.getByRole("button", { name }).first();
        if (await button.isVisible().catch(() => false)) await button.click().catch(() => {});
    }
    await page.addStyleTag({ content: `[class*="ad-container"],[id*="ad-container"],[data-testid*="ad"],[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"]{display:none!important}` }).catch(() => {});
};

const fullyVisiblePitchNumbers = async (root) => root.evaluate((element) => {
    const rootRect = element.getBoundingClientRect();
    const top = Math.max(0, rootRect.top);
    const bottom = Math.min(window.innerHeight, rootRect.bottom);
    return [...element.querySelectorAll('[role="img"][aria-label^="Pitch "]')].map((row) => ({
        number: Number(row.getAttribute("aria-label")?.match(/^Pitch\s+(\d+)/i)?.[1]), rect: row.getBoundingClientRect()
    })).filter((entry) => Number.isInteger(entry.number) && entry.rect.top >= top && entry.rect.bottom <= bottom).map((entry) => entry.number);
});

const screenshotModal = async (page, root, outputPath) => {
    const box = await root.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("打席モーダルの表示範囲を取得できません。");
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const clip = { x, y, width: Math.min(box.width, viewport.width - x), height: Math.min(box.height, viewport.height - y) };
    if (clip.width <= 0 || clip.height <= 0) throw new Error("打席モーダルが画面外です。");
    await page.screenshot({ path: outputPath, clip });
};

const captureAtBat = async ({ page, selection, play, tempDir, evidenceNumber, setState }) => {
    const sourceUrl = `https://www.mlb.com/gameday/${selection.gamePk}/play/${selection.atBatIndex}`;
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    setState("opened");
    await dismissOverlays(page);
    const root = page.locator(`#live-feed-play-${selection.atBatIndex}`).first();
    await root.waitFor({ state: "visible", timeout: 30000 });
    const pitchByPitch = page.getByRole("button", { name: /^Pitch by Pitch/ }).first();
    await pitchByPitch.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await pitchByPitch.isVisible().catch(() => false)) {
        const selected = await pitchByPitch.getAttribute("aria-selected");
        const pressed = await pitchByPitch.getAttribute("aria-pressed");
        if (selected !== "true" && pressed !== "true") await pitchByPitch.click();
    }
    setState("expanded");
    const rows = root.locator('[role="img"][aria-label^="Pitch "]');
    const expected = expectedPitchNumbers(play);
    if (expected.length) await rows.first().waitFor({ state: "visible", timeout: 15000 });
    const domPitches = await rows.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("aria-label")?.match(/^Pitch\s+(\d+)/i)?.[1])).filter(Number.isInteger));
    if (domPitches.length !== expected.length || !expected.every((pitch) => domPitches.includes(pitch))) throw new Error(`投球番号不一致 API:${expected.join(",")} DOM:${domPitches.join(",")}`);

    const dialog = root.locator("xpath=ancestor::*[@role='dialog'][1]");
    const captureRoot = await dialog.count() ? dialog : root;

    const captures = [];
    const plan = planPitchCaptures(expected.length, 5);
    for (let captureIndex = 0; captureIndex < plan.length; captureIndex += 1) {
        const target = plan[captureIndex].at(-1);
        if (target) {
            await root.locator(`[role="img"][aria-label="Pitch ${target}"]`).scrollIntoViewIfNeeded();
            await page.waitForTimeout(250);
        }
        const imagePath = path.join(tempDir, `atbat-${selection.atBatIndex}-${captureIndex}.png`);
        await screenshotModal(page, captureRoot, imagePath);
        captures.push({
            path: imagePath, captureIndex, coveredPitchNumbers: await fullyVisiblePitchNumbers(root), sourceUrl,
            inningLabel: `${selection.inning}回${selection.halfInning === "top" ? "表" : "裏"}`,
            batterName: selection.batterName || play?.matchup?.batter?.fullName || "",
            label: plan.length === 1 ? `エビデンス${evidenceNumber}` : `エビデンス${evidenceNumber}-${captureIndex + 1}`
        });
    }
    setState("captured");
    if (!hasCompleteCoverage(expected, captures)) {
        const captured = [...new Set(captures.flatMap((item) => item.coveredPitchNumbers))].sort((a, b) => a - b);
        throw new Error(`投球カバレッジ不足 expected=${expected.join(",")} captured=${captured.join(",")}`);
    }
    setState("coverage_verified");
    return captures;
};

const processJob = async (job) => {
    let browser;
    const tempDir = path.join(ROOT_DIR, "tmp", "evidence", job.id);
    try {
        await fs.mkdir(tempDir, { recursive: true });
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "ja-JP" });
        const page = await context.newPage();
        let activeGamePk = null;
        let feed = null;
        const captures = [];
        for (let index = 0; index < job.plays.length; index += 1) {
            const selection = job.plays[index];
            const item = job.items[index];
            job.message = `${selection.inning}回${selection.halfInning === "top" ? "表" : "裏"} Gameday取得中...`;
            if (activeGamePk !== selection.gamePk) {
                const response = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${selection.gamePk}/feed/live`);
                if (!response.ok) throw new Error(`MLB試合データ取得失敗: ${response.status}`);
                feed = await response.json();
                activeGamePk = selection.gamePk;
            }
            const play = (feed?.liveData?.plays?.allPlays ?? []).find((item) => Number(item?.about?.atBatIndex) === Number(selection.atBatIndex));
            const validationErrors = play ? validateSelectionAgainstPlay(selection, play) : ["atBatIndex not found"];
            if (validationErrors.length) {
                item.state = "manual_review_required";
                item.reason = validationErrors.join(", ");
                job.manualReviewRequired.push({ ...selection, reason: validationErrors.join(", ") });
                job.completedCount += 1;
                continue;
            }
            let completed = false;
            let lastError;
            for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
                try {
                    item.attempts = attempt;
                    captures.push(...await captureAtBat({
                        page, selection, play, tempDir, evidenceNumber: index + 1,
                        setState: (state) => { item.state = state; }
                    }));
                    item.state = "completed";
                    completed = true;
                } catch (error) {
                    lastError = error;
                    if (attempt < 3) await page.waitForTimeout(800 * attempt);
                }
            }
            if (!completed) {
                item.state = "manual_review_required";
                item.reason = lastError?.message || "capture failed";
                job.manualReviewRequired.push({ ...selection, reason: item.reason });
            }
            job.completedCount += 1;
        }
        if (captures.length) {
            captures.sort((left, right) => Number(path.basename(left.path).match(/^atbat-(\d+)/)?.[1]) - Number(path.basename(right.path).match(/^atbat-(\d+)/)?.[1]) || left.captureIndex - right.captureIndex);
            const gameLabel = [...new Set(job.plays.map((play) => play.gamePk))].join("-");
            job.outputPath = path.join(ROOT_DIR, "output", "pdf", `evidence-${gameLabel}.pdf`);
            job.message = "PDF作成中...";
            await createEvidencePdf({ context, captures, outputPath: job.outputPath });
        }
        await context.close();
        job.status = captures.length ? (job.manualReviewRequired.length ? "partial" : "completed") : "failed";
        job.message = job.status === "completed" ? "完了" : job.status === "partial" ? "一部の打席は手動確認が必要です" : "作成できませんでした";
    } catch (error) {
        job.status = "failed";
        job.message = error?.message || "不明なエラー";
    } finally {
        await browser?.close().catch(() => {});
    }
};

const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") { response.writeHead(204, cors); response.end(); return; }
    const url = new URL(request.url, `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/api\/evidence\/jobs\/([^/]+)(\/pdf)?$/);
    if (request.method === "POST" && url.pathname === "/api/evidence/jobs") {
        try {
            const body = await readJson(request);
            if (!Array.isArray(body.plays) || !body.plays.length) return sendJson(response, 400, { error: "打席が選択されていません。" });
            const plays = sortEvidencePlays(body.plays).filter((play) => Number.isInteger(Number(play.gamePk)) && Number.isInteger(Number(play.atBatIndex)));
            const job = {
                id: randomUUID(), status: "pending", message: "開始待ち", plays,
                items: plays.map((play) => ({ gamePk: play.gamePk, atBatIndex: play.atBatIndex, state: "pending", attempts: 0, reason: "" })),
                completedCount: 0, manualReviewRequired: [], outputPath: ""
            };
            jobs.set(job.id, job);
            sendJson(response, 202, publicJob(job));
            void processJob(job);
        } catch (error) { sendJson(response, 400, { error: error.message }); }
        return;
    }
    if (request.method === "GET" && match) {
        const job = jobs.get(match[1]);
        if (!job) return sendJson(response, 404, { error: "ジョブが見つかりません。" });
        if (match[2]) {
            if (!job.outputPath) return sendJson(response, 409, { error: "PDFはまだありません。" });
            const data = await fs.readFile(job.outputPath);
            response.writeHead(200, { ...cors, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${path.basename(job.outputPath)}"` });
            response.end(data);
            return;
        }
        sendJson(response, 200, publicJob(job));
        return;
    }
    sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Evidence server: http://127.0.0.1:${PORT}`));
