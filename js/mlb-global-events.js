"use strict";

(() => {
    const eventsByYear = Object.freeze({
        2026: Object.freeze([
            {
                id: "jackie-robinson-day",
                date: "2026-04-15",
                nameJa: "ジャッキー・ロビンソン・デー",
                summaryJa: "4月15日｜全球団のフィールド関係者が背番号42を着用",
                detailsJa: [
                    "1947年4月15日のMLBデビューと、人種の壁を破った功績を称える日です。",
                    "2026年は選手・監督・コーチなど全フィールド関係者がドジャーブルーの背番号42を着用します。",
                    "ロイヤルブルーの「42」ソックス、帽子の「42」サイドパッチ、記念ベースとラインアップカードにも注目です。"
                ],
                officialUrl: "https://www.mlb.com/press-release/press-release-major-league-baseball-celebrates-the-legacy-and-social-impact-of-jackie-robinson",
                priority: 100
            },
            {
                id: "mothers-day",
                date: "2026-05-10",
                nameJa: "母の日",
                summaryJa: "5月10日｜母への感謝と乳がん啓発",
                detailsJa: [
                    "母への感謝を示すとともに、乳がんの早期発見・研究支援を呼びかけるMLB共通企画です。",
                    "ピンクリボンのユニフォームデカールを着用し、選手はピンクのソックス、リストバンド、手袋やバットなどを使用できます。",
                    "記念ベースとラインアップカード、球場映像もピンクを基調とした演出になります。"
                ],
                officialUrl: "https://www.mlb.com/amp/press-release/release-mlb-celebrates-mother-s-day-2026.html",
                priority: 60
            },
            {
                id: "armed-forces-weekend",
                startDate: "2026-05-15",
                endDate: "2026-05-17",
                nameJa: "アームド・フォーシズ・デー・ウィークエンド",
                summaryJa: "5月15〜17日｜軍務関係者と家族へ敬意を表す週末",
                detailsJa: [
                    "軍務に携わる人々、退役軍人とその家族へ感謝を示すMLB共通企画です。",
                    "3日間、選手・監督・コーチなどが各球団ロゴ入りの特別仕様キャップを着用します。",
                    "迷彩柄ソックス、記念ベース、特別ロゴ入りラインアップカードも用意されます。"
                ],
                officialUrl: "https://www.mlb.com/press-release/release-armed-forces-day-weekend-2026",
                priority: 70
            },
            {
                id: "memorial-day",
                date: "2026-05-25",
                nameJa: "メモリアル・デー",
                summaryJa: "5月25日｜戦没者を追悼するMLB共通行事",
                detailsJa: [
                    "米国のために命を落とした軍務関係者を追悼する日です。",
                    "フィールド関係者は「Lest We Forget」の文字が入った赤いポピーをユニフォーム左胸に着用します。",
                    "現地午後3時の黙とうまたは試合前の黙とう、記念ベースとラインアップカードが予定されています。"
                ],
                officialUrl: "https://www.mlb.com/amp/press-release/release-major-league-baseball-commemorates-memorial-day-2026.html",
                priority: 75
            },
            {
                id: "lou-gehrig-day",
                date: "2026-06-02",
                nameJa: "ルー・ゲーリッグ・デー",
                summaryJa: "6月2日｜ALSへの理解・支援を目的とした記念日",
                detailsJa: [
                    "ルー・ゲーリッグの功績を称え、ALSへの理解、研究支援と患者・家族への連帯を示す日です。",
                    "6月2日はゲーリッグがヤンキースの先発一塁手となった日であり、ALSの合併症で亡くなった日でもあります。",
                    "2026年は背番号4のユニフォームデカール、赤い「4-ALS」リストバンド、記念ベースとラインアップカードが使用されます。"
                ],
                officialUrl: "https://www.mlb.com/news/phillies-lou-gehrig-day-2026-plans",
                priority: 95
            },
            {
                id: "play-ball-weekend",
                startDate: "2026-06-05",
                endDate: "2026-06-07",
                nameJa: "PLAY BALLウィークエンド",
                summaryJa: "6月5〜7日｜野球・ソフトボール参加促進の世界的企画",
                detailsJa: [
                    "子どもたちが野球やソフトボールを始め、楽しむ機会を広げるMLBの参加促進企画です。",
                    "2026年は6大陸で、MLB・MiLB球団や提携団体などによる200以上の活動が予定されています。",
                    "用具配布や体験イベントが中心で、ユニフォーム共通着用を目的とした日ではありません。"
                ],
                officialUrl: "https://www.mlb.com/press-release/press-release-play-ball-weekend-to-continue-growing-baseball-and-softball-participation-with-programming-on-six-continents-on-june-5-7-2026",
                priority: 55
            },
            {
                id: "fathers-day",
                date: "2026-06-21",
                nameJa: "父の日",
                summaryJa: "6月21日｜父への感謝と前立腺がん啓発",
                detailsJa: [
                    "父と父親代わりの人々へ感謝を示し、前立腺がんの早期発見と研究支援を呼びかける日です。",
                    "青いリボンのユニフォームデカールを着用し、選手は青いソックス、リストバンドや特別用具を使用できます。",
                    "記念ベースとラインアップカード、ホームラン・チャレンジによる研究支援にも注目です。"
                ],
                officialUrl: "https://www.mlb.com/press-release/press-release-major-league-baseball-clubs-to-honor-dads-and-raise-prostate-cancer-awareness-on-father-s-day",
                priority: 60
            },
            {
                id: "childhood-cancer-awareness-day",
                date: "2026-09-06",
                nameJa: "小児がん啓発デー",
                summaryJa: "9月6日｜MLB全球団で小児がん啓発活動",
                detailsJa: [
                    "小児がんへの理解を広げ、患者と家族、治療・研究活動を支援するMLB共通企画です。",
                    "選手・監督・コーチ・審判は金色リボンのデカールを着用し、金色のリストバンドも選択できます。",
                    "球場映像、記念ベース、ラインアップカードと各地の病院・支援団体との活動が行われます。"
                ],
                officialUrl: "https://www.mlb.com/press-release/press-release-major-league-baseball-honors-childhood-cancer-awareness-day",
                priority: 75
            },
            {
                id: "patriot-day",
                date: "2026-09-11",
                nameJa: "9.11追悼",
                summaryJa: "9月11日｜米同時多発テロから25年",
                detailsJa: [
                    "2001年9月11日の犠牲者、遺族、救助・復旧に携わった人々を全球場で追悼します。",
                    "選手・監督・コーチ・審判は「We Shall Not Forget」サイドパッチ入り特別キャップを着用します。",
                    "試合前セレモニー、黙とう、記念ベースとラインアップカード、球場映像が予定されています。"
                ],
                officialUrl: "https://www.mlb.com/press-release/press-release-major-league-baseball-honors-patriot-day-and-commemorates-the-25th-anniversary-of-september-11th-with-on-and-off-field-initiatives",
                priority: 90
            },
            {
                id: "roberto-clemente-day",
                date: "2026-09-15",
                nameJa: "ロベルト・クレメンテ・デー",
                summaryJa: "9月15日｜クレメンテの功績と社会貢献を称える日",
                detailsJa: [
                    "殿堂入り外野手ロベルト・クレメンテの野球での功績と、人道支援に尽くした生涯を称える日です。",
                    "2026年は全球団の全選手が胸に背番号21のパッチを着用します。全選手が21番のユニフォームを着る日ではありません。",
                    "パイレーツの選手・監督・コーチは21番を着用。クレメンテ賞候補者・歴代受賞者・プエルトリコ出身選手も21番を選択できます。"
                ],
                officialUrl: "https://www.mlb.com/news/roberto-clemente-day-2026-around-mlb",
                priority: 100
            }
        ])
    });

    const eventMatchesDate = (event, date) => {
        if (event.date) return event.date === date;
        return event.startDate <= date && date <= event.endDate;
    };

    const forDate = (date) => {
        const year = Number(String(date ?? "").slice(0, 4));
        return [...(eventsByYear[year] ?? [])]
            .filter((event) => eventMatchesDate(event, date))
            .sort((left, right) => right.priority - left.priority);
    };

    window.MLBGlobalEvents = Object.freeze({ eventsByYear, forDate });
})();
