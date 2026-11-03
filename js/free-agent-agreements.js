// MLB・NPB球団公式などで契約合意が確認できた選手を追加する。
// NPB契約は次の形式で追加する。通常のFA一覧にも契約先として表示される。
// playerId: {
//   league: "NPB", teamName: "球団名", teamLogoUrl: "assets/npb-team-logos/ロゴ.png",
//   agreedDate: "YYYY-MM-DD", years?: 年数, tenThousands?: 金額（万ドル）,
//   url: "球団公式などの発表URL", statusText?: "独自に表示したい契約文言"
// }
// years・tenThousandsがない場合は「※期間と金額は未公表」を自動表示する。
// MLB以外の海外リーグは追跡対象に含めない。
(function (global) {
    global.MLB_FREE_AGENT_AGREEMENTS = Object.freeze({});
})(window);
