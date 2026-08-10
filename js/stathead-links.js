(function (global) {
    "use strict";

    // Stathead uses its own player identifiers. Keep the MLB -> Stathead
    // correspondence here so scorebook and pregame views always use the
    // same verified destination.
    const STATHEAD_PLAYER_IDS = Object.freeze({
        691016: "soders000tyl"
    });

    const playerStreakFinderUrl = (mlbPlayerId) => {
        const statheadPlayerId = STATHEAD_PLAYER_IDS[Number(mlbPlayerId)];
        if (!statheadPlayerId) return "";
        const url = new URL(
            "https://www.sports-reference.com/stathead/baseball/player-batting-streak-finder.cgi"
        );
        url.searchParams.set("player_id", statheadPlayerId);
        return url.toString();
    };

    global.MLBStatheadLinks = Object.freeze({ playerStreakFinderUrl });
})(window);
