"use strict";

(() => {
    // MLB's birthCountry is a birthplace, not nationality. These overrides keep
    // the Japanese-player category from treating every Japan-born player alike.
    const INCLUDED = new Map([
        [119534, "村上 雅則"],
        [116855, "柏田 貴史"],
        [219594, "大家 友和"],
        [408193, "石井 一久"],
        [425781, "マイケル 中村"],
        [493131, "小林 雅英"]
    ]);
    const EXCLUDED = new Set([
        112252, // Steve Chitren: born in Japan, not a Japanese MLB player.
        118623  // Jeff McCurry: born in Japan, not a Japanese MLB player.
    ]);

    const playerId = (personOrId) => Number(
        typeof personOrId === "object" ? personOrId?.id : personOrId
    );
    const isJapanesePlayer = (person) => {
        const id = playerId(person);
        if (EXCLUDED.has(id)) return false;
        if (INCLUDED.has(id)) return true;
        return String(person?.birthCountry ?? person?.country ?? "").trim().toLowerCase() === "japan";
    };
    const japaneseName = (personOrId) => INCLUDED.get(playerId(personOrId)) || "";

    globalThis.MLBJapanesePlayers = Object.freeze({
        isJapanesePlayer,
        japaneseName,
        includedIds: Object.freeze([...INCLUDED.keys()]),
        excludedIds: Object.freeze([...EXCLUDED])
    });
})();
