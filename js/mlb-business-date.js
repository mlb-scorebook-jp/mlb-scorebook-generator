"use strict";

(() => {
    const TOKYO_TIME_ZONE = "Asia/Tokyo";
    const DAY_BOUNDARY_HOUR = 23;
    const DAY_BOUNDARY_MINUTE = 30;

    const tokyoPartsFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: TOKYO_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });

    const formatDateParts = (date) => {
        const parts = tokyoPartsFormatter.formatToParts(date);
        return Object.fromEntries(parts.map((part) => [part.type, part.value]));
    };

    const getTodayGameDate = (now = new Date()) => {
        const instant = now instanceof Date ? now : new Date(now);
        if (Number.isNaN(instant.getTime())) {
            throw new TypeError("有効な日時を指定してください。");
        }

        const parts = formatDateParts(instant);
        const hour = Number(parts.hour);
        const minute = Number(parts.minute);
        const isBeforeBoundary =
            hour < DAY_BOUNDARY_HOUR ||
            (hour === DAY_BOUNDARY_HOUR && minute < DAY_BOUNDARY_MINUTE);

        // Tokyoの日付要素をUTC上の暦日として組み立て、端末のタイムゾーンに
        // 依存せず月跨ぎ・年跨ぎを含む前日計算を行う。
        const gameDate = new Date(Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day)
        ));
        if (isBeforeBoundary) gameDate.setUTCDate(gameDate.getUTCDate() - 1);
        return gameDate.toISOString().slice(0, 10);
    };

    globalThis.MLBGameDate = Object.freeze({
        getTodayGameDate,
        timeZone: TOKYO_TIME_ZONE,
        boundary: "23:30"
    });
})();
