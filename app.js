"use strict";

const urlInput = document.getElementById("gameday-url");
const loadButton = document.getElementById("load-btn");
const generateButton = document.getElementById("generate-btn");
const scorebookPreview = document.querySelector(".scorebook");

const gameInfoElements = {
    home: document.getElementById("home-team"),
    away: document.getElementById("away-team"),
    date: document.getElementById("game-date"),
    ballpark: document.getElementById("ballpark"),
    status: document.getElementById("game-status")
};
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

function setGameInfo(key, value) {
    const element = gameInfoElements[key];

    if (!element) {
        return;
    }

    element.textContent = value;
}

function resetGameInfo() {
    setGameInfo("home", "—");
    setGameInfo("away", "—");
    setGameInfo("date", "—");
    setGameInfo("ballpark", "—");
    setGameInfo("status", "未取得");
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

    setGameInfo("home", gameData.gameData.teams.home.name);
setGameInfo("away", gameData.gameData.teams.away.name);

console.log("DATETIME:", gameData.gameData.datetime);

setGameInfo("date", gameData.gameData.datetime.officialDate);

setGameInfo("ballpark", gameData.gameData.venue.name);
setGameInfo("status", gameData.gameData.status.detailedState);

   const awayLineup = gameData.liveData.boxscore.teams.away.battingOrder.map(playerId => {
    return gameData.liveData.boxscore.teams.away.players["ID" + playerId].person.fullName;
});

console.log(awayLineup);
/*
showPreviewMessage(
    "AWAY LINEUP",
    awayLineup.join("<br>")
);
*/

    loadButton.textContent = "試合IDを確認しました";

    /*
showPreviewMessage(
    "GAMEDAY URL ACCEPTED",
    `GAME ID : ${gamePk}`
);
*/

    console.log("Gameday URL:", url);
    console.log("Game ID:", gamePk);
}

function generateScorebook() {
    if (!state.loaded) {
        alert("先に試合データを取得してください。");
        return;
    }

    /*
showPreviewMessage(
    "SCOREBOOK GENERATION READY",
    `GAME ID：${state.gamePk}`
);
*/

    setGameInfo("status", "スコアブック生成準備完了");
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