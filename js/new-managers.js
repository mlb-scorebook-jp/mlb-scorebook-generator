// シーズン終了後にMLB球団が公式発表した翌季の監督人事。
(function (global) {
    global.MLB_NEW_MANAGERS = Object.freeze({
        2026: Object.freeze([
            Object.freeze({
                league: "AL",
                teamId: 136,
                teamName: "Seattle Mariners",
                managerName: "J.カンズラー",
                announcedDate: "2026-11-03",
                statusText: "新監督就任",
                sourceUrl: "https://www.mlb.com/mariners/press-release/" +
                    "mariners-name-jason-kanzler-field-manager"
            }),
            Object.freeze({
                league: "NL",
                teamId: 143,
                teamName: "Philadelphia Phillies",
                managerName: "D.マッティングリー",
                announcedDate: "2026-10-14",
                statusText: "2年契約で続投",
                sourceUrl: "https://www.mlb.com/phillies/news/" +
                    "don-mattingly-phillies-manager-return-2027"
            })
        ])
    });
})(window);
