"use strict";

(() => {
    const API_ROOT = "http://127.0.0.1:43123/api/evidence";
    const selected = new Map();
    let active = false;
    let processing = false;
    let pollTimer = null;

    const dom = {
        toggle: document.getElementById("evidence-mode-toggle"),
        panel: document.getElementById("evidence-mode-panel"),
        count: document.getElementById("evidence-mode-count"),
        progress: document.getElementById("evidence-mode-progress"),
        create: document.getElementById("evidence-create-pdf"),
        clear: document.getElementById("evidence-clear"),
        exit: document.getElementById("evidence-mode-exit"),
        result: document.getElementById("evidence-mode-result")
    };

    const numberOrNull = (value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    };

    const readSelection = (cell) => ({
        gamePk: numberOrNull(cell.dataset.gamePk),
        atBatIndex: numberOrNull(cell.dataset.atBatIndex),
        playId: String(cell.dataset.playId || ""),
        inning: numberOrNull(cell.dataset.inning),
        halfInning: String(cell.dataset.halfInning || ""),
        batterId: numberOrNull(cell.dataset.batterId),
        pitcherId: numberOrNull(cell.dataset.pitcherId),
        eventIndex: numberOrNull(cell.dataset.eventIndex),
        batterName: String(cell.dataset.batterName || "")
    });

    const selectionKey = (item) => `${item.gamePk}:${item.atBatIndex}`;

    const updateControls = () => {
        dom.count.textContent = `選択：${selected.size}打席`;
        dom.create.disabled = processing || selected.size === 0;
        dom.clear.disabled = processing || selected.size === 0;
        dom.exit.disabled = processing;
        dom.toggle.disabled = processing;
    };

    const clearSelection = () => {
        selected.clear();
        document.querySelectorAll(".evidence-selected").forEach((cell) => {
            cell.classList.remove("evidence-selected");
            cell.setAttribute("aria-pressed", "false");
        });
        updateControls();
    };

    const setActive = (next) => {
        active = next;
        document.body.classList.toggle("evidence-mode", active);
        dom.toggle.hidden = active;
        dom.panel.hidden = !active;
        if (!active) clearSelection();
        updateControls();
    };

    const setResult = (message, downloadUrl = "") => {
        dom.result.hidden = false;
        dom.result.replaceChildren(document.createTextNode(message));
        if (downloadUrl) {
            const link = document.createElement("a");
            link.href = downloadUrl;
            link.textContent = "PDFをダウンロード";
            link.target = "_blank";
            dom.result.append(document.createElement("br"), link);
        }
    };

    const pollJob = async (jobId) => {
        try {
            const response = await fetch(`${API_ROOT}/jobs/${encodeURIComponent(jobId)}`);
            if (!response.ok) throw new Error("進捗を取得できませんでした。");
            const job = await response.json();
            dom.progress.hidden = false;
            dom.progress.textContent = `資料作成中\n${job.completedCount} / ${job.totalCount} 打席\n${job.message || "処理中..."}`;
            if (["completed", "partial", "failed"].includes(job.status)) {
                processing = false;
                clearTimeout(pollTimer);
                const failures = job.manualReviewRequired || [];
                const failureText = failures.length
                    ? `\n手動確認必要：${failures.map((item) => `${item.inning}回${item.halfInning === "top" ? "表" : "裏"}（打席${item.atBatIndex}）`).join("、")}`
                    : "";
                setResult(job.status === "failed" ? `PDFを作成できませんでした。${failureText}` : `エビデンスPDFを作成しました。${failureText}`, job.downloadUrl ? `http://127.0.0.1:43123${job.downloadUrl}` : "");
                updateControls();
                return;
            }
            pollTimer = setTimeout(() => pollJob(jobId), 800);
        } catch (error) {
            processing = false;
            dom.progress.hidden = true;
            setResult(error.message);
            updateControls();
        }
    };

    const createPdf = async () => {
        processing = true;
        dom.result.hidden = true;
        dom.progress.hidden = false;
        dom.progress.textContent = "資料作成中\n0 / 0 打席\nローカル補助サーバーへ接続中...";
        updateControls();
        const plays = [...selected.values()].sort((left, right) =>
            left.atBatIndex - right.atBatIndex || left.eventIndex - right.eventIndex
        );
        try {
            const response = await fetch(`${API_ROOT}/jobs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plays })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || "補助サーバーへ接続できませんでした。");
            }
            const job = await response.json();
            await pollJob(job.id);
        } catch (error) {
            processing = false;
            dom.progress.hidden = true;
            setResult(`${error.message}\n先に「scripts/start-evidence-server.sh」を起動してください。`);
            updateControls();
        }
    };

    document.addEventListener("click", (event) => {
        if (!active || processing) return;
        const cell = event.target.closest(".evidence-selectable-atbat");
        if (!cell) return;
        event.preventDefault();
        event.stopPropagation();
        const item = readSelection(cell);
        if (!item.gamePk || item.atBatIndex === null) return;
        const key = selectionKey(item);
        if (selected.has(key)) {
            selected.delete(key);
            cell.classList.remove("evidence-selected");
            cell.setAttribute("aria-pressed", "false");
        } else {
            selected.set(key, item);
            cell.classList.add("evidence-selected");
            cell.setAttribute("aria-pressed", "true");
        }
        updateControls();
    }, true);

    dom.toggle?.addEventListener("click", () => setActive(true));
    dom.exit?.addEventListener("click", () => setActive(false));
    dom.clear?.addEventListener("click", clearSelection);
    dom.create?.addEventListener("click", createPdf);
    updateControls();
})();
