(function registerHistoricalRecords(global) {
    "use strict";

    /*
     * Curated records are intentionally separate from ordinary milestones.
     * Add only records supported by an authoritative historical source.
     */
    global.HISTORICAL_RECORDS = Object.freeze([
        Object.freeze({
            gamePk: 824644,
            gameDate: "2026-08-15",
            playerId: 695491,
            playerName: "J.バイエズ",
            teamId: 138,
            recordType: "MLB史上初",
            recordKey: "mlb-debut-first-three-at-bats-home-runs",
            recordValue: 3,
            priority: -1,
            comparisonTarget: "MLBデビュー戦の初打席から3打席連続本塁打",
            sourceTitle: "3 HRs in 1st 3 at-bats?! Cards prospect Báez first to accomplish feat in epic big league debut",
            sourceUrl: "https://www.mlb.com/news/joshua-baez-mlb-debut",
            displayText: "STL　J.バイエズ　デビュー戦で初打席から3打席連続本塁打（MLB史上初）",
            dedupeTokens: Object.freeze([
                "J.バイエズ",
                "初打席から3打席連続本塁打"
            ])
        }),
        Object.freeze({
            gamePk: 166301,
            gameDate: "1974-04-08",
            playerId: 110001,
            playerName: "H.アーロン",
            teamId: 144,
            recordType: "MLB新記録",
            recordKey: "career-home-runs-715",
            recordValue: 715,
            priority: 0,
            comparisonTarget: "ベーブ・ルースの通算714本塁打",
            displayText: "ATL　H.アーロン　通算715本塁打（MLB新記録）",
            dedupeTokens: Object.freeze(["H.アーロン", "通算715本塁打"])
        }),
        Object.freeze({
            gamePk: 22418,
            gameDate: "2004-10-01",
            playerId: 400085,
            playerName: "I.スズキ",
            teamId: 136,
            recordType: "MLB新記録",
            recordKey: "single-season-hits-258",
            recordValue: 258,
            priority: 0,
            comparisonTarget: "ジョージ・シスラーのシーズン257安打",
            displayText: "SEA　I.スズキ　シーズン258安打（MLB新記録）",
            dedupeTokens: Object.freeze(["I.スズキ", "シーズン258安打"])
        }),
        Object.freeze({
            gamePk: 210602,
            gameDate: "1995-09-06",
            playerId: 121222,
            playerName: "C.リプケン Jr.",
            teamId: 110,
            recordType: "MLB新記録",
            recordKey: "consecutive-games-played-2131",
            recordValue: 2131,
            priority: 0,
            comparisonTarget: "ルー・ゲーリッグの2130試合連続出場",
            displayText: "BAL　C.リプケン Jr.　2131試合連続出場（MLB新記録）",
            dedupeTokens: Object.freeze(["C.リプケン", "2131試合連続出場"])
        }),
        Object.freeze({
            gamePk: 69823,
            gameDate: "2007-08-07",
            playerId: 111188,
            playerName: "B.ボンズ",
            teamId: 137,
            recordType: "MLB新記録",
            recordKey: "career-home-runs-756",
            recordValue: 756,
            priority: 0,
            comparisonTarget: "ハンク・アーロンの通算755本塁打",
            displayText: "SF　B.ボンズ　通算756本塁打（MLB新記録）",
            dedupeTokens: Object.freeze(["B.ボンズ", "通算756本塁打"])
        })
    ]);
})(window);
