import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPHQL_URL = "https://data-graph.mlb.com/graphql";
const NEWS_PATH = "sel-mlb-news-list?$limit=30";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "js/mlb-latest-news.js");
const playerNamesPath = resolve(root, "js/players.js");

const normalizeName = (value) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const playerNamesSource = await readFile(playerNamesPath, "utf8");
const playerNamesStart = playerNamesSource.indexOf("{");
const playerNamesEnd = playerNamesSource.lastIndexOf("};");
if (playerNamesStart < 0 || playerNamesEnd < playerNamesStart) {
    throw new Error("NHK player-name table could not be read");
}
const playerNames = JSON.parse(playerNamesSource.slice(playerNamesStart, playerNamesEnd + 1));
const newsPlayerNameOverrides = new Map([
    ["tommyjohn", "T.ジョン"]
]);

const teamNames = new Map([
    [108, ["エンゼルス", "LAA"]], [109, ["ダイヤモンドバックス", "AZ"]],
    [110, ["オリオールズ", "BAL"]], [111, ["レッドソックス", "BOS"]],
    [112, ["カブス", "CHC"]], [113, ["レッズ", "CIN"]],
    [114, ["ガーディアンズ", "CLE"]], [115, ["ロッキーズ", "COL"]],
    [116, ["タイガース", "DET"]], [117, ["アストロズ", "HOU"]],
    [118, ["ロイヤルズ", "KC"]], [119, ["ドジャース", "LAD"]],
    [120, ["ナショナルズ", "WSH"]], [121, ["メッツ", "NYM"]],
    [133, ["アスレチックス", "ATH"]], [134, ["パイレーツ", "PIT"]],
    [135, ["パドレス", "SD"]], [136, ["マリナーズ", "SEA"]],
    [137, ["ジャイアンツ", "SF"]], [138, ["カージナルス", "STL"]],
    [139, ["レイズ", "TB"]], [140, ["レンジャーズ", "TEX"]],
    [141, ["ブルージェイズ", "TOR"]], [142, ["ツインズ", "MIN"]],
    [143, ["フィリーズ", "PHI"]], [144, ["ブレーブス", "ATL"]],
    [145, ["ホワイトソックス", "CWS"]], [146, ["マーリンズ", "MIA"]],
    [147, ["ヤンキース", "NYY"]], [158, ["ブルワーズ", "MIL"]]
]);

const query = `
query Latest($path:String!,$language:Language,$source:ContentSource){
  items:getContentListFromPath(path:$path,language:$language,source:$source){
    ... on Article{
      headline slug contentDate relativeSiteUrl
      tags{
        __typename
        ... on TeamTag{team{id name}}
        ... on PersonTag{person{id fullName}}
        ... on TaxonomyTag{slug}
      }
    }
  }
}`;

const japaneseSummaries = new Map([
    ["jacob-misiorowski-notches-200th-strikeout-of-season-vs-twins",
        "J.ミザロウスキー（MIL）、MLB史上2番目の速さでシーズン200奪三振に到達"],
    ["phillies-host-former-players-in-ode-to-moonlight-graham-from-field-of-dreams",
        "フィリーズ、元選手4人に『フィールド・オブ・ドリームス』さながらの特別な一日"],
    ["eduardo-rodriguez-lead-d-backs-to-series-win-over-dodgers",
        "E.ロドリゲス（AZ）が115球の好投、ドジャースとのシーズン対戦勝ち越しに貢献"],
    ["chris-sale-ejected-before-game-against-yankees",
        "C.セール（ATL）、登板予定のないヤンキース戦の試合前に退場処分"],
    ["kyle-schwarber-hits-two-homers-in-phillies-walk-off-win",
        "K.シュワーバー（PHI）が2本塁打、サヨナラ勝利で一発不振を脱出"],
    ["grant-holmes-pitches-6-scoreless-innings-in-win-over-yankees",
        "G.ホームズ（ATL）が6回無失点、延長10回の投手戦を制し3連敗を阻止"],
    ["sunday-night-baseball-on-peacock-nbc-for-2026-mlb-season",
        "プレーオフ争いのアストロズとパドレスがサンデーナイトで対戦"],
    ["jacob-wilson-mlb-error-free-shortstop-record",
        "J.ウィルソン（ATH）、遊撃手で111試合連続無失策のMLB記録を樹立"],
    ["marcelo-mayer-excited-to-join-giants-after-trade-from-red-sox",
        "M.マイヤー（SF）、少年時代から応援したジャイアンツ加入に意欲"],
    ["pete-alonso-homers-twice-in-orioles-win-over-rangers",
        "P.アロンゾ（BAL）、移籍後初の1試合2本塁打でレンジャーズ戦大勝をけん引"],
    ["mlb-tv-trade-deadline-2026-sale",
        "MLB.TV、トレード期限セールを実施"],
    ["austin-hays-padres-contract",
        "A.ヘイズ（SD）、トレード期限後にパドレスと契約"],
    ["craig-kimbrel-royals-2026-contract",
        "C.キンブレル（KC）、救援陣強化へロイヤルズ加入"],
    ["matthew-boyd-ian-happ-lead-cubs-win-vs-royals",
        "M.ボイド（CHC）、7回を投げロイヤルズ戦大勝に貢献"],
    ["adley-rutschman-eyeing-red-sox-debut-in-toronto",
        "A.ラッチマン（BOS）、次のブルージェイズ戦で移籍後初出場へ"],
    ["jj-wetherholt-gets-game-winning-hit-vs-rockies",
        "J.ウェザーホルト（STL）、8回の決勝二塁打でカージナルスを勝利へ"],
    ["cam-schlittler-pitches-7-strong-innings-against-braves",
        "C.シュリットラー（NYY）が7回好投も、反撃及ばずブレーブスに敗戦"],
    ["mets-score-11-runs-to-win-series-vs-pirates",
        "メッツ、11得点の猛攻でパイレーツとのシリーズ勝ち越し"],
    ["mlb-competitive-balance-issue-explained",
        "MLBの戦力均衡を巡る現状と課題を解説"],
    ["tarik-skubal-dodger-stadium-debut-with-dodgers",
        "T.スクーバル（LAD）、ドジャー・スタジアムで移籍後初先発へ"],
    ["anthony-eyanson-kyson-witherspoon-orioles-debuts",
        "ラッチマンとのトレードで加入した有望株2人がマイナー初登板で好投"],
    ["griffin-jax-placed-on-15-day-injured-list-with-right-elbow-discomfort",
        "G.ジャックス（TB）が右肘の違和感で15日間IL入り、G.グローブ昇格"],
    ["kyle-stowers-exits-marlins-game-with-hamstring-injury",
        "K.ストワーズ（MIA）、2点適時打後に左ハムストリングの違和感で交代"],
    ["gerrit-cole-picks-up-1-000th-strikeout-as-a-yankee",
        "G.コール（NYY）、ヤンキース加入後通算1000奪三振を達成"],
    ["shohei-ohtani-plays-catch-in-knee-injury-recovery",
        "大谷翔平（LAD）がキャッチボールを再開。レギュラーシーズン中の投手復帰の可能性を残している。"],
    ["max-scherzer-enters-top-10-all-time-strikeout-leaderboard",
        "M.シャーザー（TOR）、通算3516奪三振でMLB歴代10位へ浮上"],
    ["cooper-pratt-placed-on-injured-list-with-hamstring-injury",
        "C.プラット（MIL）、ハムストリング負傷で10日間IL入り"],
    ["red-sox-lose-to-a-s-to-snap-9-game-winning-streak",
        "レッドソックス、9回の同点機を逃し連勝が9でストップ"],
    ["white-sox-rally-for-win-after-retiring-ozzie-guillen-s-number",
        "T.ピーターズ（CWS）らの5得点の反撃で、O.ギーエン永久欠番式後の一戦に勝利"],
    ["tommy-john-misses-old-timers-day-for-health-reasons",
        "T.ジョン（NYY）、闘病を支えるファンとチームメートへ感謝"],
    ["walt-weiss-ejected-after-run-scoring-balk-on-chris-sale",
        "C.セール（ATL）の失点につながるボーク判定でW.ワイス監督が退場"],
    ["mlb-2026-top-potential-postseason-rotations",
        "ポストシーズン進出候補、先発ローテーション上位球団を比較"],
    ["sandy-alcantara-sets-marlins-franchise-record-for-innings-pitched",
        "S.アルカンタラ（MIA）、今季3度目のマーリンズ投球回記録を樹立"],
    ["jackson-jobe-pitches-5-scoreless-innings-in-return-from-tommy-john-surgery",
        "J.ジョーブ（DET）、手術からの復帰初先発で勝利"],
    ["examining-placement-zack-wheeler-foot-pitchers-mound",
        "Z.ウィーラー（PHI）、投球時の軸足を巡り注目集まる"],
    ["jacob-degrom-pitches-five-innings-in-rangers-win-vs-orioles",
        "J.デグロム（TEX）が本来の投球を取り戻し、プレーオフ争いをけん引"],
    ["adley-rutschman-doubles-in-first-triple-a-rehab-start-for-red-sox",
        "A.ラッチマン（BOS）、リハビリ初戦で二塁打と盗塁阻止"],
    ["baseball-injury-updates",
        "大谷翔平（LAD）らMLB各球団の最新負傷情報"],
    ["jac-caglianone-hits-two-home-runs-in-royals-win-vs-cubs",
        "J.カグリアノン（KC）、特大2本塁打を含む4安打"],
    ["mlb-field-of-dreams-game-best-moments",
        "フィールド・オブ・ドリームス・ゲーム名場面トップ5"],
    ["corbin-carroll-s-girlfriend-emma-broyles-sings-national-anthem",
        "C.キャロル（AZ）の恋人が国歌斉唱、本人は本塁打をもぎ取る好守"],
    ["andrew-vaughn-s-rbi-single-completes-comeback-against-twins",
        "ブルワーズ、ベンチメンバーの活躍で逆転勝利"],
    ["michael-king-jackson-merrill-lead-padres-win-over-astros",
        "M.キング（SD）の好投とJ.メリルの一発でパドレス勝利"],
    ["ronny-simon-helps-lead-pirates-past-mets",
        "R.サイモン（PIT）、攻守とSNSで存在感"],
    ["clay-holmes-goes-four-innings-in-cubs-debut-vs-royals",
        "C.ホームズ（CHC）、5月以来のメジャー復帰登板"],
    ["griffin-jax-scratched-from-start-vs-mariners",
        "G.ジャックス（TB）とT.ウォールズが試合前に出場回避"],
    ["carlos-rodon-to-begin-minor-league-rehab-saturday",
        "C.ロドン（NYY）、リハビリ登板で48球　復帰後の起用法も検討"],
    ["andrew-alvarez-holds-off-reds-in-nationals-win",
        "A.アルバレス（WSH）、再び好投し先発陣の重要戦力へ"],
    ["carson-benge-out-of-mets-lineup-with-wrist-injury",
        "C.ベンジ（NYM）、左手首の負傷で欠場も早期復帰を見込む"],
    ["brad-lord-leads-strong-effort-by-nationals-bullpen",
        "B.ロード（WSH）ら救援陣が好投、ナショナルズが4月以来の3連戦スイープ"],
    ["lefty-batters-dominating-2026",
        "2026年は左打者が躍進、その要因をデータで分析"]
]);

const officialUrl = (relativeSiteUrl, slug) => {
    const candidate = relativeSiteUrl || `/news/${slug}`;
    const parsed = new URL(candidate, "https://www.mlb.com");
    if (parsed.protocol !== "https:" ||
        !(parsed.hostname === "mlb.com" || parsed.hostname.endsWith(".mlb.com"))) {
        throw new Error(`Unexpected MLB article URL: ${parsed.href}`);
    }
    return parsed.href;
};

const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        query,
        variables: { path: NEWS_PATH, language: "EN_US", source: "MLB" }
    })
});
if (!response.ok) throw new Error(`MLB news request failed: ${response.status}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(payload.errors[0]?.message || "MLB GraphQL error");

const articles = (payload.data?.items ?? []).map((article) => {
    const teams = article.tags
        ?.filter((tag) => tag.__typename === "TeamTag" && tag.team?.id)
        .map((tag) => ({ id: Number(tag.team.id), name: tag.team.name })) ?? [];
    const players = article.tags
        ?.filter((tag) => tag.__typename === "PersonTag" && tag.person?.id)
        .map((tag) => ({ id: Number(tag.person.id), name: tag.person.fullName })) ?? [];
    const taxonomy = article.tags
        ?.filter((tag) => tag.__typename === "TaxonomyTag" && tag.slug)
        .map((tag) => tag.slug) ?? [];
    const primaryTeam = teamNames.get(teams[0]?.id);
    const playerDisplayName = players[0]
        ? newsPlayerNameOverrides.get(normalizeName(players[0].name)) ||
            playerNames[normalizeName(players[0].name)] || players[0].name
        : "";
    const subject = playerDisplayName
        ? `${playerDisplayName}${primaryTeam ? `（${primaryTeam[1]}）` : ""}`
        : primaryTeam?.[0] || "MLBの最新情報";
    return {
        headline: article.headline,
        summaryJa: japaneseSummaries.get(article.slug) || `MLB公式が${subject}について報じた。`,
        slug: article.slug,
        url: officialUrl(article.relativeSiteUrl, article.slug),
        contentDate: article.contentDate,
        teamIds: teams.map((team) => team.id),
        playerIds: players.map((player) => player.id),
        taxonomy
    };
});

const source = `// MLB公式Latest Newsから自動生成。手動編集しないでください。\n` +
    `(function (global) {\n` +
    `    global.MLB_LATEST_NEWS = Object.freeze(${JSON.stringify(articles, null, 4)});\n` +
    `})(window);\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, source, "utf8");
console.log(`Updated ${articles.length} MLB official news articles.`);
