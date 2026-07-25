"use strict";

const urlInput = document.getElementById("gameday-url");
const loadButton = document.getElementById("load-btn");
const generateButton = document.getElementById("generate-btn");
const scorebookPreview = document.querySelector(".scorebook");

const gameInfoRows = document.querySelectorAll(".game-info p");
const footerButtons = document.querySelectorAll(".footer button");

const state = {
    gamePk: null,
    gamedayUrl: "",
    gameData: null,
    loaded: false
};

/**
 * MLB Gameday URLから試合IDを抽出
 */
function extractGamePk(url) {
    try {
        const parsedUrl = new URL(url.trim());

        if (!parsedUrl.hostname.endsWith("mlb.com")) {
            return null;
        }

        const pathParts = parsedUrl.pathname
            .split("/")
            .filter(Boolean);

        return (
            pathParts.find((part) => /^\d{6,7}$/.test(part)) ||
            null
        );
    } catch (error) {
        return null;
    }
}

/**
 * 左側の試合情報を更新
 */
function setGameInfo(index, label, value) {
    if (!gameInfoRows[index]) {
        return;
    }

    gameInfoRows[index].textContent = `${label}：${value}`;
}

function resetGameInfo() {
    setGameInfo(0, "HOME", "—");
    setGameInfo(1, "AWAY", "—");
    setGameInfo(2, "DATE", "—");
    setGameInfo(3, "BALLPARK", "—");
    setGameInfo(4, "STATUS", "未取得");
}

/**
 * 中央プレビューへメッセージを表示
 */
function showPreviewMessage(title, detail = "") {
    scorebookPreview.innerHTML = `
        <div class="preview-message">
            <strong>${title}</strong>
            ${detail ? `<span>${detail}</span>` : ""}
        </div>
    `;
}

/**
 * MLBから試合データを取得
 */
async function fetchGameData(gamePk) {
    const endpoint =
        `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;

    const response = await fetch(endpoint);

    if (!response.ok) {
        throw new Error(
            `MLBデータ取得エラー：HTTP ${response.status}`
        );
    }

    return response.json();
}

/**
 * 日付を日本向け表示に変換
 */
function formatDate(dateString) {
    if (!dateString) {
        return "—";
    }

    const parts = dateString.split("-");

    if (parts.length !== 3) {
        return dateString;
    }

    return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

/**
 * 取得したデータを画面へ表示
 */
function displayGameData(data) {
    const gameData = data.gameData;

    const homeTeam =
        gameData?.teams?.home?.name || "不明";

    const awayTeam =
        gameData?.teams?.away?.name || "不明";

    const officialDate =
        formatDate(gameData?.datetime?.officialDate);

    const venue =
        gameData?.venue?.name || "不明";

    const status =
        gameData?.status?.detailedState || "不明";

    setGameInfo(0, "HOME", homeTeam);
    setGameInfo(1, "AWAY", awayTeam);
    setGameInfo(2, "DATE", officialDate);
    setGameInfo(3, "BALLPARK", venue);
    setGameInfo(4, "STATUS", status);

    showPreviewMessage(
        `${awayTeam} at ${homeTeam}`,
        `${officialDate}　${venue}`
    );
}

/**
 * 「試合データを取得」
 */
async function loadGameData() {
    const url = urlInput.value.trim();

    if (!url) {
        alert("MLB GamedayのURLを入力してください。");
        urlInput.focus();
        return;
    }

    const gamePk = extractGamePk(url);

    if (!gamePk) {
        alert("有効なMLB Gameday URLを確認できませんでした。");
        urlInput.focus();
        return;
    }

    state.gamePk = gamePk;
    state.gamedayUrl = url;
    state.gameData = null;
    state.loaded = false;

    loadButton.disabled = true;
    loadButton.textContent = "試合データを取得中…";

    setGameInfo(0, "HOME", "取得中…");
    setGameInfo(1, "AWAY", "取得中…");
    setGameInfo(2, "DATE", "取得中…");
    setGameInfo(3, "BALLPARK", "取得中…");
    setGameInfo(4, "STATUS", `試合ID ${gamePk}`);

    showPreviewMessage(
        "LOADING GAME DATA",
        `GAME ID：${gamePk}`
    );

    try {
        const data = await fetchGameData(gamePk);

        state.gameData = data;
        state.loaded = true;

        displayGameData(data);

        loadButton.textContent = "試合データ取得完了";

        console.log("MLB game data:", data);
    } catch (error) {
        console.error(error);

        state.loaded = false;

        resetGameInfo();

        setGameInfo(
            4,
            "STATUS",
            "データ取得失敗"
        );

        showPreviewMessage(
            "GAME DATA ERROR",
            error.message
        );

        loadButton.textContent = "もう一度取得";

        alert(
            "MLBの試合データを取得できませんでした。\n" +
            "URLまたは通信状態を確認してください。"
        );
    } finally {
        loadButton.disabled = false;
    }
}

/**
 * スコアブック生成
 */
function generateScorebook() {
    if (!state.loaded || !state.gameData) {
        alert("先に試合データを取得してください。");
        return;
    }

    const gameData = state.gameData.gameData;

    const homeTeam =
        gameData?.teams?.home?.name || "HOME";

    const awayTeam =
        gameData?.teams?.away?.name || "AWAY";

    showPreviewMessage(
        "SCOREBOOK GENERATION READY",
        `${awayTeam} at ${homeTeam}`
    );

    setGameInfo(
        4,
        "STATUS",
        "スコアブック生成準備完了"
    );
}

/**
 * JSONファイルを保存
 */
function downloadJson() {
    if (!state.gameData) {
        alert("先に試合データを取得してください。");
        return;
    }

    const jsonText = JSON.stringify(
        state.gameData,
        null,
        2
    );

    const blob = new Blob(
        [jsonText],
        { type: "application/json" }
    );

    const downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `mlb-game-${state.gamePk}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadUrl);
}

/**
 * 下部の出力ボタン
 */
function handleOutput(event) {
    const outputType =
        event.currentTarget.textContent.trim();

    if (!state.loaded) {
        alert("先に試合データを取得してください。");
        return;
    }

    if (outputType === "PRINT") {
        window.print();
        return;
    }

    if (outputType === "JSON") {
        downloadJson();
        return;
    }

    alert(`${outputType}出力機能は現在準備中です。`);
}

loadButton.addEventListener(
    "click",
    loadGameData
);

generateButton.addEventListener(
    "click",
    generateScorebook
);

urlInput.addEventListener(
    "keydown",
    (event) => {
        if (event.key === "Enter") {
            loadGameData();
        }
    }
);

footerButtons.forEach((button) => {
    button.addEventListener(
        "click",
        handleOutput
    );
});

resetGameInfo();            ${detail ? `<span>${detail}</span>` : ""}
        </div>
    `;
}

function loadGameData() {
    const url = urlInput.value.trim();

    if (!url) {
        alert("MLB GamedayのURLを入力してください。");
        urlInput.focus();
        return;
    }

    const gamePk = extractGamePk(url);

    if (!gamePk) {
        alert("有効なMLB Gameday URLを確認できませんでした。");
        urlInput.focus();
        return;
    }

    state.gamePk = gamePk;
    state.gamedayUrl = url;
    state.loaded = true;

    setGameInfo(0, "HOME", "取得準備中");
    setGameInfo(1, "AWAY", "取得準備中");
    setGameInfo(2, "DATE", "取得準備中");
    setGameInfo(3, "BALLPARK", "取得準備中");
    setGameInfo(4, "STATUS", `試合ID ${gamePk} を確認`);

    loadButton.textContent = "試合IDを確認しました";

    showPreviewMessage(
        "GAMEDAY URL ACCEPTED",
        `GAME ID：${gamePk}`
    );

    console.log("Gameday URL:", url);
    console.log("Game ID:", gamePk);
}

function generateScorebook() {
    if (!state.loaded) {
        alert("先に試合データを取得してください。");
        return;
    }

    showPreviewMessage(
        "SCOREBOOK GENERATION READY",
        `GAME ID：${state.gamePk}`
    );

    setGameInfo(4, "STATUS", "スコアブック生成準備完了");
}

function handleOutput(event) {
    const outputType = event.currentTarget.textContent.trim();

    if (!state.loaded) {
        alert("先に試合データを取得してください。");
        return;
    }

    if (outputType === "PRINT") {
        window.print();
        return;
    }

    alert(`${outputType}出力機能は現在準備中です。`);
}

loadButton.addEventListener("click", loadGameData);
generateButton.addEventListener("click", generateScorebook);

urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        loadGameData();
    }
});

footerButtons.forEach((button) => {
    button.addEventListener("click", handleOutput);
});

resetGameInfo();
