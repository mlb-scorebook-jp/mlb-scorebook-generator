// MLB公式「各球団の主な2026-27年FA予定選手」を基にしたシーズン中の注目候補。
// Source: https://www.mlb.com/news/baseball-s-biggest-free-agents-by-team-for-2026-2027
(function (global) {
    const sourceUrl = "https://www.mlb.com/news/baseball-s-biggest-free-agents-by-team-for-2026-2027";
    const contractYearsByPlayerId = Object.freeze({
        543807: 6,
        642547: 5,
        543243: 3,
        608032: 2,
        628452: 4,
        645261: 5,
        673357: 6,
        592866: 2,
        605540: 2,
        673548: 5,
        664040: 6,
        592662: 5
    });
    global.MLB_FREE_AGENT_CANDIDATES = Object.freeze({
        2026: Object.freeze([
            { playerId: 543807, name: "George Springer", teamId: 141, position: "DH" },
            { playerId: 669432, name: "Trevor Rogers", teamId: 110, position: "LHP", pitcherRole: "SP" },
            { playerId: 642547, name: "Freddy Peralta", teamId: 121, position: "RHP", pitcherRole: "SP" },
            { playerId: 543243, name: "Sonny Gray", teamId: 111, position: "RHP", pitcherRole: "SP" },
            { playerId: 665862, name: "Jazz Chisholm Jr.", teamId: 147, position: "2B" },
            { playerId: 656492, name: "Foster Griffin", teamId: 120, position: "LHP", pitcherRole: "RP" },
            { playerId: 608032, name: "Carlos Estévez", teamId: 118, position: "RHP", pitcherRole: "RP" },
            { playerId: 650402, name: "Gleyber Torres", teamId: 116, position: "2B" },
            { playerId: 680777, name: "Ryan Jeffers", teamId: 142, position: "C" },
            { playerId: 656794, name: "Sean Newcomb", teamId: 145, position: "LHP", pitcherRole: "RP" },
            { playerId: 660162, name: "Yoán Moncada", teamId: 108, position: "3B" },
            { playerId: 650556, name: "Bryan Abreu", teamId: 117, position: "RHP", pitcherRole: "RP" },
            { playerId: 641680, name: "Jonah Heim", teamId: 144, position: "C" },
            { playerId: 668227, name: "Randy Arozarena", teamId: 136, position: "LF" },
            { playerId: 641302, name: "Tyler Alexander", teamId: 140, position: "LHP", pitcherRole: "RP" },
            { playerId: 628452, name: "Raisel Iglesias", teamId: 144, position: "RHP", pitcherRole: "RP" },
            { playerId: 645261, name: "Sandy Alcantara", teamId: 146, position: "RHP", pitcherRole: "SP" },
            { playerId: 673357, name: "Luis Robert Jr.", teamId: 121, position: "CF" },
            { playerId: 592866, name: "Trevor Williams", teamId: 120, position: "RHP", pitcherRole: "SP" },
            { playerId: 650333, name: "Luis Arraez", teamId: 137, position: "2B" },
            { playerId: 605540, name: "Brandon Woodruff", teamId: 158, position: "RHP", pitcherRole: "SP" },
            { playerId: 602104, name: "Ramón Urías", teamId: 138, position: "3B" },
            { playerId: 673548, name: "Seiya Suzuki", teamId: 112, position: "RF" },
            { playerId: 664040, name: "Brandon Lowe", teamId: 134, position: "2B" },
            { playerId: 553993, name: "Eugenio Suárez", teamId: 113, position: "DH" },
            { playerId: 668678, name: "Zac Gallen", teamId: 109, position: "RHP", pitcherRole: "SP" },
            { playerId: 669373, name: "Tarik Skubal", teamId: 116, position: "LHP", pitcherRole: "SP" },
            { playerId: 664141, name: "JT Brubaker", teamId: 137, position: "RHP", pitcherRole: "RP" },
            { playerId: 592662, name: "Robbie Ray", teamId: 137, position: "LHP", pitcherRole: "SP" },
            { playerId: 608372, name: "Tomoyuki Sugano", teamId: 115, position: "RHP", pitcherRole: "SP" }
        ].map((entry) => Object.freeze({
            ...entry,
            contractYears: contractYearsByPlayerId[entry.playerId] || 1,
            sourceUrl
        })))
    });
})(window);
