// MLB・NPB球団公式などで契約合意が確認できた選手を追加する。
// NPB契約は { league: "NPB", teamName, teamLogoUrl, agreedDate, url, statusText? } を使用する。
// MLB以外の海外リーグは追跡対象に含めない。
(function (global) {
    global.MLB_FREE_AGENT_AGREEMENTS = Object.freeze({});
})(window);
