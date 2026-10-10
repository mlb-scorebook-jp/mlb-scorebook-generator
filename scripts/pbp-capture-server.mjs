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

const fit = (width, height, maxWidth, maxHeight) => {
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return { width: width * scale, height: height * scale };
};

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
                // 該当プレーが描画されたら、残っている広告通信を止めてから開く。
                await page.evaluate(() => window.stop()).catch(() => {});
                await playButton.click();
                detailDialog = page.getByRole("dialog")
                    .filter({ hasText: event.description || "win probability" })
                    .first();
            }
        }
        await detailDialog.waitFor({ state: "visible", timeout: 20000 });
        const pitchTab = detailDialog.getByText("Pitch by Pitch", { exact: true }).first();
        if (await pitchTab.isVisible().catch(() => false)) {
            await pitchTab.click().catch(() => {});
            await page.waitForTimeout(700);
        }
        const card = detailDialog.locator('[class*="overlaystyle__ContentWrapper"]').first();
        await card.waitFor({ state: "visible", timeout: 10000 });
        const shot = await card.screenshot({ type: "png" });
        console.log(`[${new Date().toISOString()}] captured ${event.type}:${event.atBatIndex}`);
        return shot;
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
    return shot;
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
    const page = await browserContext.newPage();
    const pdf = await PDFDocument.create();
    try {
        for (const event of job.events) {
            const bytes = await captureEvent(page, job, event);
            const image = await pdf.embedPng(bytes);
            const sheet = pdf.addPage([841.89, 595.28]);
            const size = fit(image.width, image.height, 813.89, 567.28);
            sheet.drawImage(image, {
                x: (841.89 - size.width) / 2,
                y: (595.28 - size.height) / 2,
                width: size.width,
                height: size.height
            });
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
                "content-disposition": `attachment; filename="${filename}"`,
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
