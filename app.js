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
    loaded: false
};

/**
 * MLB Gameday URLから試合IDを抽出する
 *
 * 対応例:
 * https://www.mlb.com/gameday/.../823759/final/wrap
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

        const gamePk = pathParts.find((part) => /^\d{6,7}$/.test(part));

        return gamePk || null;
    } catch (error) {
        return null;
    }
}

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

function showPreviewMessage(title, detail = "") {
    scorebookPreview.innerHTML = `
        <div class="preview-message">
            <strong>${title}</strong>
            ${detail ? `<span>${detail}</span>` : ""}
        </div>
    `;
}

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
    state.loaded = true;
    console.log("① fetch開始");

    const gameData = await fetchGameData(gamePk);

    console.log("② fetch完了");

    setGameInfo(0, "HOME", gameData.gameData.teams.home.name);
    setGameInfo(1, "AWAY", gameData.gameData.teams.away.name);
    
    console.log("DATETIME:", gameData.gameData.datetime);
    
    setGameInfo(2, "DATE", gameData.gameData.datetime.officialDate);


   setGameInfo(3, "BALLPARK", gameData.gameData.venue.name);
    setGameInfo(4, "STATUS", gameData.gameData.status.detailedState);

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

async function fetchGameData(gamePk) {
    const response = await fetch(
        `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
    );

    if (!response.ok) {
        throw new Error("試合データを取得できませんでした。");
    }

    return await response.json();
}