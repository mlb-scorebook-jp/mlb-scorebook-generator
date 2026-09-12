import fs from "node:fs/promises";
import path from "node:path";

export const sortEvidencePlays = (plays) => [...plays].sort((left, right) =>
    Number(left.atBatIndex) - Number(right.atBatIndex) || Number(left.eventIndex) - Number(right.eventIndex)
);

export const expectedPitchNumbers = (play) => (play?.playEvents ?? [])
    .filter((event) => event?.isPitch === true)
    .map((_event, index) => index + 1);

export const hasCompleteCoverage = (expected, captures) => {
    const captured = new Set(captures.flatMap((capture) => capture.coveredPitchNumbers));
    return expected.length === captured.size && expected.every((pitch) => captured.has(pitch));
};

export const planPitchCaptures = (pitchCount, pageSize = 5) => {
    if (pitchCount <= 0) return [[]];
    const captures = [];
    let start = 1;
    while (start <= pitchCount) {
        const end = Math.min(pitchCount, start + pageSize - 1);
        captures.push(Array.from({ length: end - start + 1 }, (_, index) => start + index));
        if (end === pitchCount) break;
        start = end;
    }
    return captures;
};

export const validateSelectionAgainstPlay = (selection, play) => {
    const errors = [];
    const expected = {
        atBatIndex: Number(play?.about?.atBatIndex),
        inning: Number(play?.about?.inning),
        halfInning: String(play?.about?.halfInning ?? "").toLowerCase(),
        batterId: Number(play?.matchup?.batter?.id),
        pitcherId: Number(play?.matchup?.pitcher?.id)
    };
    for (const [key, value] of Object.entries(expected)) {
        if (String(selection?.[key] ?? "") !== String(value ?? "")) errors.push(`${key} mismatch`);
    }
    const selectedPlayId = String(selection?.playId ?? "");
    if (selectedPlayId && !(play?.playEvents ?? []).some((event) => event?.playId === selectedPlayId)) errors.push("playId mismatch");
    const lastEvent = play?.playEvents?.at(-1);
    const eventIndex = Number.isInteger(Number(lastEvent?.index))
        ? Number(lastEvent.index)
        : (play?.playEvents?.length ?? 0) - 1;
    if (Number(selection?.eventIndex) !== eventIndex) errors.push("eventIndex mismatch");
    return errors;
};

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const createEvidencePdf = async ({ context, captures, outputPath }) => {
    const pdfPage = await context.newPage();
    const pages = [];
    for (const capture of captures) {
        const image = await fs.readFile(capture.path);
        pages.push(`<section class="page"><header><strong>${escapeHtml(capture.label)}</strong><span>${escapeHtml(capture.inningLabel)}　${escapeHtml(capture.batterName)}</span></header><main><img src="data:image/png;base64,${image.toString("base64")}" alt="MLB Gameday evidence"></main><footer>${escapeHtml(capture.sourceUrl)}</footer></section>`);
    }
    await pdfPage.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;color:#161616}.page{height:190mm;display:grid;grid-template-rows:9mm 1fr 6mm;break-after:page}.page:last-child{break-after:auto}header{display:flex;align-items:center;justify-content:space-between;font-size:11pt}header span{color:#444;font-size:9pt}main{min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}img{display:block;max-width:100%;max-height:100%;object-fit:contain}footer{overflow:hidden;color:#666;font-size:6.5pt;text-overflow:ellipsis;white-space:nowrap}</style></head><body>${pages.join("")}</body></html>`, { waitUntil: "load" });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await pdfPage.pdf({ path: outputPath, format: "A4", landscape: true, printBackground: true });
    await pdfPage.close();
};
