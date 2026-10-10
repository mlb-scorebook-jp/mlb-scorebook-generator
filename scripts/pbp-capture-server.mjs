import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");

const PORT = 8765;
const ROOT = path.resolve(import.meta.dirname, "..");
// 撮影結果はGit管理中の見本PDFを上書きしない専用フォルダへ保存する。
const OUTPUT = path.join(ROOT, "output", "pbp-captures");
const fileTokens = new Map();

const browserCandidates = process.platform === "win32"
    ? [
        process.env.PBP_BROWSER_PATH,
        path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe")
    ]
    : [
        process.env.PBP_BROWSER_PATH,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];

const browserExecutable = () => browserCandidates.find((candidate) =>
    candidate && fsSync.existsSync(candidate));

const json = (response, status, body) => {
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-private-network": "true"
    });
    response.end(JSON.stringify(body));
};

const waitingPage = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PBP資料を作成中</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fa;color:#172331;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif}.panel{width:min(560px,calc(100% - 40px));padding:48px 36px;text-align:center;background:#fff;border:1px solid #d6dee7;border-radius:16px;box-shadow:0 14px 40px rgba(23,35,49,.12)}.spinner{width:52px;height:52px;margin:0 auto 26px;border:6px solid #dce7f0;border-top-color:#0878be;border-radius:50%;animation:spin 1s linear infinite}h1{margin:0 0 18px;font-size:28px}p{margin:8px 0;line-height:1.8;font-size:17px}.note{color:#607080;font-size:14px}@keyframes spin{to{transform:rotate(360deg)}}</style>
</head><body><main class="panel"><div class="spinner" aria-hidden="true"></div><h1>PBP資料を作成中</h1><p>完成したらダウンロードフォルダに保存されます。</p><p class="note">打席数によって1分ほどかかる場合があります。この画面を開いたままお待ちください。</p></main>
<script>(async()=>{const heading=document.querySelector("h1"),message=document.querySelector("p"),spinner=document.querySelector(".spinner");try{const job=JSON.parse(decodeURIComponent(location.hash.slice(1)));history.replaceState(null,"",location.pathname);const response=await fetch("/capture",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(job)});if(!response.ok)throw new Error("撮影サーバーの応答: "+response.status);const result=await response.json();if(!result.url)throw new Error("PDFの保存先を取得できませんでした。");heading.textContent="PBP資料が完成しました";message.textContent="ダウンロードフォルダへの保存を開始します。";spinner.style.display="none";location.href=result.url}catch(error){heading.textContent="PBP資料を作成できませんでした";message.textContent="元の画面へ戻って、もう一度実行してください。";spinner.style.display="none";document.querySelector(".note").textContent=error?.message||String(error)}})();</script>
</body></html>`;

const closeOverlays = async (page) => {
    for (const label of ["Accept & Continue", "Accept All", "I Accept", "Continue"]) {
        const button = page.getByRole("button", { name: label, exact: false }).first();
        if (await button.isVisible().catch(() => false)) await button.click().catch(() => {});
        const textLink = page.getByText(label, { exact: false }).first();
        if (await textLink.isVisible().catch(() => false)) await textLink.click().catch(() => {});
    }
};

const captureEvent = async (page, job, event) => {
    const base = `https://www.mlb.com/gameday/${job.gamePk}`;
    const url = event.type === "atbat"
        ? `${base}/play/${event.atBatIndex}`
        : `${base}/final`;
    console.log(`[${new Date().toISOString()}] opening ${event.type}:${event.atBatIndex ?? "pitching-change"}`);
    // MLB Gamedayは解析用通信が長く続くことがある。HTML全体の完了を待たず、
    // ページ遷移が始まった時点から描画待ちへ進める。
    const navigation = page.goto(url, { waitUntil: "commit", timeout: 30000 }).catch(() => null);
    await Promise.race([navigation, page.waitForTimeout(12000)]);
    // 見た目の描画後、タブ切替のReactイベントが有効になるまで待つ。
    await page.waitForTimeout(12000);
    await closeOverlays(page);
    if (event.type === "atbat") {
        let detailDialog = page.getByRole("dialog")
            .filter({ hasText: event.description || "win probability" })
            .first();
        if (!(await detailDialog.isVisible().catch(() => false))) {
            const allFilter = page.getByText("All", { exact: true }).first();
            if (await allFilter.isVisible().catch(() => false)) {
                await allFilter.click().catch(() => {});
                await page.waitForTimeout(700);
            }
            const playButton = page.getByRole("button", {
                name: event.description || "play detail",
                exact: false
            }).last();
            await Promise.race([
                detailDialog.waitFor({ state: "visible", timeout: 30000 }),
                playButton.waitFor({ state: "visible", timeout: 30000 })
            ]);
            if (!(await detailDialog.isVisible().catch(() => false))) {
                await playButton.click();
                detailDialog = page.getByRole("dialog")
                    .filter({ hasText: event.description || "win probability" })
                    .first();
            }
        }
        await detailDialog.waitFor({ state: "visible", timeout: 20000 });
        const pitchTabLabel = detailDialog.getByText("Pitch by Pitch", { exact: true }).first();
        if (await pitchTabLabel.isVisible().catch(() => false)) {
            const pitchTabButton = pitchTabLabel.locator("..");
            await pitchTabButton.focus();
            await pitchTabButton.press("Enter");
            await page.waitForTimeout(1200);
        }
        await detailDialog.getByRole("img", { name: "Pitch 1", exact: true })
            .waitFor({ state: "visible", timeout: 10000 });
        const card = detailDialog.locator('[class*="overlaystyle__ContentWrapper"]').first();
        await card.waitFor({ state: "visible", timeout: 10000 });
        const shots = [await card.screenshot({ type: "png" })];
        const pitchList = detailDialog.locator('[class*="atbatstyle__LiveFeedWrapper"]').first();
        const scroll = await pitchList.evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight
        }));
        const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
        for (let offset = Math.min(scroll.clientHeight, maxScroll); offset > 0;) {
            await pitchList.evaluate((element, top) => { element.scrollTop = top; }, offset);
            await page.waitForTimeout(250);
            shots.push(await card.screenshot({ type: "png" }));
            if (offset >= maxScroll) break;
            offset = Math.min(offset + scroll.clientHeight, maxScroll);
        }
        console.log(`[${new Date().toISOString()}] captured ${event.type}:${event.atBatIndex}`);
        return shots;
    } else {
        const allFilter = page.getByText("All", { exact: true }).first();
        if (await allFilter.isVisible().catch(() => false)) {
            await allFilter.click().catch(() => {});
            await page.waitForTimeout(1800);
        }
        const names = [event.incomingPitcher, event.outgoingPitcher].filter(Boolean);
        const searchNames = [...new Set(names.flatMap((name) => [name, name.split(/\s+/).at(-1)]))]
            .filter(Boolean);
        const pattern = searchNames.length
            ? new RegExp(searchNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i")
            : /Pitching (Change|Substitution)/i;
        let target = page.getByText(pattern).last();
        for (let attempt = 0; attempt < 45 && !(await target.isVisible().catch(() => false)); attempt += 1) {
            await page.mouse.move(1260, 760);
            await page.mouse.wheel(0, 260);
            await page.waitForTimeout(220);
            target = page.getByText(pattern).last();
        }
        if (await target.count().catch(() => 0)) {
            await target.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(700);
        }
    }
    await closeOverlays(page);
    const shot = await page.screenshot({ type: "png", fullPage: false });
    console.log(`[${new Date().toISOString()}] captured ${event.type}:${event.atBatIndex ?? "pitching-change"}`);
    return [shot];
};

const makePdf = async (job) => {
    await fs.mkdir(OUTPUT, { recursive: true });
    try {
        const feedResponse = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${job.gamePk}/feed/live`);
        if (feedResponse.ok) {
            const feed = await feedResponse.json();
            const plays = feed?.liveData?.plays?.allPlays ?? [];
            for (const event of job.events) {
                if (event.type !== "atbat" || event.description) continue;
                event.description = plays.find((play) =>
                    Number(play?.atBatIndex) === Number(event.atBatIndex))?.result?.description || "";
            }
        }
    } catch {
        // Gameday側でも対象プレーを探すため、公式フィード取得失敗時も続行する。
    }
    const executablePath = browserExecutable();
    if (!executablePath) {
        throw new Error("Google Chrome または Microsoft Edge が見つかりません。");
    }
    const browser = await chromium.launch({ headless: true, executablePath });
    const browserContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1.4
    });
    await browserContext.route(/doubleclick|googlesyndication|googletagmanager|amazon-adsystem|scorecardresearch|flashtalking/i,
        (route) => route.abort());
    const pdf = await PDFDocument.create();
    try {
        const captures = new Array(job.events.length);
        let nextIndex = 0;
        const workerCount = Math.min(2, job.events.length);
        const workers = Array.from({ length: workerCount }, async () => {
            const page = await browserContext.newPage();
            try {
                while (nextIndex < job.events.length) {
                    const index = nextIndex;
                    nextIndex += 1;
                    captures[index] = await captureEvent(page, job, job.events[index]);
                }
            } finally {
                await page.close().catch(() => {});
            }
        });
        await Promise.all(workers);
        const cards = captures.flat();
        const pageWidth = 841.89;
        const pageHeight = 595.28;
        // 約5.6mmの外周余白を確保し、Windowsの一般的な印刷可能範囲に収める。
        const margin = 16;
        const gap = 5;
        const columns = 4;
        const rows = 2;
        const cardsPerPage = columns * rows;
        const cellWidth = (pageWidth - margin * 2 - gap * (columns - 1)) / columns;
        const cellHeight = (pageHeight - margin * 2 - gap * (rows - 1)) / rows;
        for (let start = 0; start < cards.length; start += cardsPerPage) {
            const sheet = pdf.addPage([pageWidth, pageHeight]);
            const group = cards.slice(start, start + cardsPerPage);
            const images = await Promise.all(group.map((bytes) => pdf.embedPng(bytes)));
            for (let row = 0; row < rows; row += 1) {
                const rowImages = images.slice(row * columns, (row + 1) * columns);
                if (!rowImages.length) break;
                const commonHeight = Math.min(
                    cellHeight,
                    ...rowImages.map((image) => cellWidth * image.height / image.width)
                );
                const cellY = pageHeight - margin - (row + 1) * cellHeight - row * gap;
                for (let column = 0; column < rowImages.length; column += 1) {
                    const image = rowImages[column];
                    const width = commonHeight * image.width / image.height;
                    const cellX = margin + column * (cellWidth + gap);
                    sheet.drawImage(image, {
                        x: cellX + (cellWidth - width) / 2,
                        y: cellY + cellHeight - commonHeight,
                        width,
                        height: commonHeight
                    });
                }
            }
        }
    } finally {
        await browser.close();
    }
    const safe = String(`${job.date || "game"}_${job.away || "AWAY"}@${job.home || "HOME"}_PBP資料`)
        .replace(/[^\p{L}\p{N}@._-]/gu, "_");
    const filename = `${safe}.pdf`;
    await fs.writeFile(path.join(OUTPUT, filename), await pdf.save());
    return filename;
};

const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
        response.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-private-network": "true"
        });
        return response.end();
    }
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && request.url === "/waiting") {
        response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store"
        });
        return response.end(waitingPage);
    }
    if (request.method === "GET" && request.url?.startsWith("/files/")) {
        const token = path.basename(request.url.slice(7)).replace(/\.pdf$/i, "");
        if (!/^[0-9a-z-]+$/i.test(token)) {
            return json(response, 404, { error: "PDFが見つかりません。" });
        }
        const filename = fileTokens.get(token) || `${token}.pdf`;
        try {
            const bytes = await fs.readFile(path.join(OUTPUT, `${token}.pdf`));
            response.writeHead(200, {
                "content-type": "application/pdf",
                "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
                "access-control-allow-origin": "*",
                "access-control-allow-private-network": "true"
            });
            return response.end(bytes);
        } catch {
            return json(response, 404, { error: "PDFが見つかりません。" });
        }
    }
    if (request.method === "POST" && request.url === "/capture-download") {
        try {
            console.log(`[${new Date().toISOString()}] form capture request received`);
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
            const job = JSON.parse(params.get("job") || "{}");
            if (!Number(job.gamePk) || !Array.isArray(job.events) || !job.events.length) {
                return json(response, 400, { error: "撮影対象がありません。" });
            }
            const filename = await makePdf(job);
            const bytes = await fs.readFile(path.join(OUTPUT, filename));
            response.writeHead(200, {
                "content-type": "application/pdf",
                "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
            });
            console.log(`[${new Date().toISOString()}] form capture completed: ${filename}`);
            return response.end(bytes);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] form capture failed:`, error);
            return json(response, 500, { error: error?.message || String(error) });
        }
    }
    if (request.method !== "POST" || request.url !== "/capture") {
        return json(response, 404, { error: "Not found" });
    }
    try {
        console.log(`[${new Date().toISOString()}] capture request received`);
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!Number(job.gamePk) || !Array.isArray(job.events) || !job.events.length) {
            return json(response, 400, { error: "撮影対象がありません。" });
        }
        const filename = await makePdf(job);
        const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        fileTokens.set(token, filename);
        await fs.copyFile(path.join(OUTPUT, filename), path.join(OUTPUT, `${token}.pdf`));
        console.log(`[${new Date().toISOString()}] capture completed: ${filename}`);
        return json(response, 200, {
            ok: true,
            filename,
            url: `http://127.0.0.1:${PORT}/files/${token}.pdf`
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] capture failed:`, error);
        return json(response, 500, { error: error?.message || String(error) });
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`PBP capture server: http://127.0.0.1:${PORT}`);
});
