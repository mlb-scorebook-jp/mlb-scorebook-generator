"use strict";

(() => {
    const MODES = Object.freeze({
        full: "1試合フル",
        first: "前半担当",
        second: "後半担当",
        other: "他試合"
    });
    const TEAM_SHORT_NAMES = Object.freeze({
        ARI: "ダイヤモンドバックス", ATH: "アスレチックス", ATL: "ブレーブス",
        BAL: "オリオールズ", BOS: "レッドソックス", CHC: "カブス",
        CWS: "ホワイトソックス", CIN: "レッズ", CLE: "ガーディアンズ",
        COL: "ロッキーズ", DET: "タイガース", HOU: "アストロズ",
        KC: "ロイヤルズ", LAA: "エンゼルス", LAD: "ドジャース",
        MIA: "マーリンズ", MIL: "ブルワーズ", MIN: "ツインズ",
        NYM: "メッツ", NYY: "ヤンキース", PHI: "フィリーズ",
        PIT: "パイレーツ", SD: "パドレス", SEA: "マリナーズ",
        SF: "ジャイアンツ", STL: "カーディナルス", TB: "レイズ",
        TEX: "レンジャーズ", TOR: "ブルージェイズ", WSH: "ナショナルズ"
    });
    const PITCH_NAMES = Object.freeze({
        FF: "フォーシーム", FA: "フォーシーム", SI: "シンカー", FC: "カットボール",
        SL: "スライダー", ST: "スイーパー", CU: "カーブ", KC: "ナックルカーブ",
        CH: "チェンジアップ", FS: "スプリット", FO: "スプリット",
        KN: "ナックル", SC: "スクリュー", EP: "イーファス"
    });
    const CIRCLED = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
    const encoder = new TextEncoder();
    const selection = [];
    let selectionSequence = 0;
    const arrangeSelection = () => {
        selection.sort(mode === "other"
            ? (a, b) => Number(a.selectionOrder) - Number(b.selectionOrder)
            : (a, b) => Number(a.atBatIndex) - Number(b.atBatIndex));
    };
    let active = false;
    let mode = "full";
    let toolbar = null;
    let dialog = null;
    const starterNoteCache = new Map();
    const starterNotes = new Map();

    const context = () => window.ScorebookHighlightContext;
    const snapshot = () => context()?.getSnapshot?.() ?? null;
    const text = (value) => String(value ?? "").trim();
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const circled = (value) => CIRCLED[number(value)] ?? String(value);
    const xml = (value) => text(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

    const shortTeam = (side, data = snapshot()) => {
        const abbreviation = text(data?.[side]?.abbreviation).toUpperCase();
        return TEAM_SHORT_NAMES[abbreviation] || text(data?.[side]?.name) || abbreviation;
    };

    const getAtBatIndex = (play) => number(play?.about?.atBatIndex ?? play?.atBatIndex);
    const allPlays = (data = snapshot()) => data?.gameData?.liveData?.plays?.allPlays ?? [];
    const findPlay = (atBatIndex, data = snapshot()) => allPlays(data).find((play) =>
        getAtBatIndex(play) === Number(atBatIndex));
    const familyNameKey = (person) => {
        const suffixes = /^(?:Jr\.?|Sr\.?|II|III|IV)$/i;
        const parts = text(person?.fullName || person?.nameFirstLast).split(/\s+/).filter(Boolean);
        while (parts.length && suffixes.test(parts.at(-1))) parts.pop();
        return text(person?.lastName || person?.lastFirstName?.split(",")[0] || parts.at(-1))
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
    };

    const gamePeople = (data = snapshot()) => {
        const boxscore = data?.gameData?.liveData?.boxscore?.teams ?? {};
        const people = ["away", "home"].flatMap((side) =>
            Object.values(boxscore?.[side]?.players ?? {}).map((entry) => entry?.person));
        allPlays(data).forEach((play) => {
            people.push(play?.matchup?.batter, play?.matchup?.pitcher);
        });
        return people.filter(Boolean);
    };

    const duplicateFamilyName = (person, data = snapshot()) => {
        const key = familyNameKey(person);
        if (!key) return false;
        const identities = new Set(gamePeople(data)
            .filter((candidate) => familyNameKey(candidate) === key)
            .map((candidate) => number(candidate?.id) || text(candidate?.fullName).toLowerCase())
            .filter(Boolean));
        return identities.size > 1;
    };

    const resolvedPerson = (person, data = snapshot()) =>
        data?.gameData?.gameData?.players?.[`ID${number(person?.id)}`] ?? person;

    const isJapanesePlayer = (person, data = snapshot()) => {
        const resolved = resolvedPerson(person, data);
        return globalThis.MLBJapanesePlayers?.isJapanesePlayer?.(resolved) ??
            [resolved?.birthCountry, resolved?.country]
                .some((country) => text(country).toLowerCase() === "japan");
    };

    const playerName = (person, data = snapshot()) => {
        const resolved = resolvedPerson(person, data);
        const displayed = context()?.getPersonName?.(resolved) ||
            text(resolved?.fullName || resolved?.nameFirstLast || resolved?.lastName);
        if (isJapanesePlayer(resolved, data)) {
            const withoutInitial = displayed.replace(/^(?:[A-ZＡ-Ｚ]\.)+\s*/u, "");
            return withoutInitial.split(/[\s　]+/)[0] || withoutInitial;
        }
        if (!displayed || duplicateFamilyName(person, data)) return displayed;
        const withoutInitial = displayed.replace(/^(?:[A-ZＡ-Ｚ]\.)+\s*/u, "");
        if (withoutInitial !== displayed) return withoutInitial;
        const officialLastName = text(person?.lastName);
        return officialLastName && /^[-A-Za-z .']+$/.test(displayed) ? officialLastName : displayed;
    };

    const inningLabel = (play) => {
        const half = play?.about?.isTopInning === true ||
            text(play?.about?.halfInning).toLowerCase() === "top" ? "表" : "裏";
        return `${circled(play?.about?.inning)}回${half}`;
    };

    const battingSide = (play) => play?.about?.isTopInning === true ||
        text(play?.about?.halfInning).toLowerCase() === "top" ? "away" : "home";

    const pitchEvents = (play) => (play?.playEvents ?? []).filter((event) => event?.isPitch);
    const finalPitch = (play) => pitchEvents(play).at(-1) ?? null;
    const playPosition = (play, data = snapshot()) => allPlays(data).indexOf(play);
    const scoreAfter = (play) => ({
        away: number(play?.result?.awayScore),
        home: number(play?.result?.homeScore)
    });
    const scoreBefore = (play, data = snapshot()) => {
        const index = playPosition(play, data);
        if (index <= 0) return { away: 0, home: 0 };
        return scoreAfter(allPlays(data)[index - 1]);
    };
    const scoreForSide = (score, side) => number(score?.[side]);
    const opponentSide = (side) => side === "away" ? "home" : "away";

    const battingOrder = (play, data = snapshot()) => {
        const side = battingSide(play);
        const batterId = number(play?.matchup?.batter?.id);
        const entry = data?.gameData?.liveData?.boxscore?.teams?.[side]
            ?.players?.[`ID${batterId}`];
        const order = Number.parseInt(entry?.battingOrder, 10);
        return Number.isFinite(order) && order > 0 ? Math.floor(order / 100) : 0;
    };

    const outsBeforePlay = (play, data = snapshot()) => {
        const explicit = Number(play?.about?.startOuts);
        if (Number.isFinite(explicit)) return explicit;
        const index = playPosition(play, data);
        if (index <= 0) return 0;
        const previous = allPlays(data)[index - 1];
        const sameHalf = number(previous?.about?.inning) === number(play?.about?.inning) &&
            battingSide(previous) === battingSide(play);
        return sameHalf ? number(previous?.count?.outs) : 0;
    };

    const outSituation = (play, data = snapshot()) => {
        const outs = outsBeforePlay(play, data);
        return outs === 0 ? "ノーアウト" : outs === 1 ? "ワンアウト" : "ツーアウト";
    };

    const baseSituation = (play, data = snapshot()) => {
        const matchup = play?.matchup ?? {};
        const occupiedBases = new Set();
        if (matchup.preOnFirst) occupiedBases.add("1B");
        if (matchup.preOnSecond) occupiedBases.add("2B");
        if (matchup.preOnThird) occupiedBases.add("3B");

        // The live feed does not always expose matchup.preOn*. The runners on
        // the current play still contain their starting bases, which is the
        // authoritative pre-pitch state needed by the narration.
        (play?.runners ?? []).forEach((runner) => {
            const start = text(runner?.movement?.start || runner?.movement?.originBase).toUpperCase();
            if (["1B", "2B", "3B"].includes(start)) occupiedBases.add(start);
        });
        const runnersById = new Map();
        const targetPosition = playPosition(play, data);
        allPlays(data).slice(0, targetPosition).forEach((candidate) => {
            if (number(candidate?.about?.inning) !== number(play?.about?.inning) ||
                battingSide(candidate) !== battingSide(play)) return;
            (candidate?.runners ?? []).forEach((runner) => {
                const runnerId = number(runner?.details?.runner?.id);
                const end = text(runner?.movement?.end).toUpperCase();
                if (!runnerId) return;
                if (["1B", "2B", "3B"].includes(end) && runner?.movement?.isOut !== true) {
                    runnersById.set(runnerId, end);
                } else {
                    runnersById.delete(runnerId);
                }
            });
        });
        runnersById.forEach((base) => occupiedBases.add(base));
        const occupied = [
            occupiedBases.has("3B") ? "③塁" : "",
            occupiedBases.has("2B") ? "②塁" : "",
            occupiedBases.has("1B") ? "①塁" : ""
        ].filter(Boolean);
        return occupied.length ? occupied.join("・") : "ランナーなし";
    };

    const scoringContext = (play, data = snapshot()) => {
        const side = battingSide(play);
        const other = opponentSide(side);
        const before = scoreBefore(play, data);
        const after = scoreAfter(play);
        const beforeOwn = scoreForSide(before, side);
        const beforeOther = scoreForSide(before, other);
        const afterOwn = scoreForSide(after, side);
        const afterOther = scoreForSide(after, other);
        const runs = Math.max(0, afterOwn - beforeOwn);
        if (!runs) return { runs: 0, label: "" };
        if (beforeOwn === 0 && beforeOther === 0) return { runs, label: "先制" };
        if (beforeOwn < beforeOther && afterOwn > afterOther) return { runs, label: "逆転" };
        if (beforeOwn < beforeOther && afterOwn === afterOther) return { runs, label: "同点" };
        if (beforeOwn === beforeOther && afterOwn > afterOther) return { runs, label: "勝ち越し" };
        if (beforeOwn > beforeOther) return { runs, label: "追加点" };
        return { runs, label: "反撃" };
    };

    const pitcherAppearanceNumber = (play, data = snapshot()) => {
        const side = opponentSide(battingSide(play));
        const ids = [];
        const targetPosition = playPosition(play, data);
        allPlays(data).slice(0, targetPosition + 1).forEach((candidate) => {
            if (opponentSide(battingSide(candidate)) !== side) return;
            const id = number(candidate?.matchup?.pitcher?.id);
            if (id && !ids.includes(id)) ids.push(id);
        });
        const targetId = number(play?.matchup?.pitcher?.id);
        const index = ids.indexOf(targetId);
        return index >= 0 ? index + 1 : 0;
    };

    const playLeadLines = (play, previousSelected, data = snapshot()) => {
        const lines = [];
        const sameInning = previousSelected &&
            number(previousSelected?.about?.inning) === number(play?.about?.inning) &&
            battingSide(previousSelected) === battingSide(play);
        const previousInning = number(previousSelected?.about?.inning);
        const currentInning = number(play?.about?.inning);
        const previousSide = previousSelected ? battingSide(previousSelected) : "";
        const currentSide = battingSide(play);
        const movesToBottom = previousSelected && previousSide === "away" &&
            currentSide === "home" && previousInning === currentInning;
        const movesToNextTop = previousSelected && previousSide === "home" &&
            currentSide === "away" && currentInning === previousInning + 1;
        const consecutive = previousSelected &&
            playPosition(play, data) === playPosition(previousSelected, data) + 1;
        const order = battingOrder(play, data);
        const batter = playerName(play?.matchup?.batter, data) || "打者";
        const firstPlayOfHalf = allPlays(data).find((candidate) =>
            number(candidate?.about?.inning) === currentInning &&
            battingSide(candidate) === currentSide);
        const isLeadoffPlay = firstPlayOfHalf === play;
        const battingTeam = shortTeam(currentSide, data);
        if (isLeadoffPlay && movesToBottom) {
            lines.push(`Ｑ　その裏、${battingTeam}は${order ? `${circled(order)}番` : ""}${batter}`);
        } else if (isLeadoffPlay && movesToNextTop) {
            lines.push(
                `Ｑ　直後の${circled(currentInning)}回表、` +
                `${battingTeam}は${order ? `${circled(order)}番` : ""}${batter}`
            );
        } else if (movesToBottom) lines.push("Ｑ　その裏");
        else if (movesToNextTop) lines.push(`Ｑ　直後の${circled(currentInning)}回表`);
        else if (!sameInning) {
            lines.push(`Ｑ　${inningLabel(play)}`);
            if (isLeadoffPlay) {
                lines.push(`　　${battingTeam}は${order ? `${circled(order)}番` : ""}${batter}`);
            }
        }
        else if (consecutive) lines.push("Ｑ　続く打者");
        else lines.push("Ｑ　この後");

        const pitcherChanged = previousSelected &&
            battingSide(previousSelected) === battingSide(play) &&
            number(previousSelected?.matchup?.pitcher?.id) !== number(play?.matchup?.pitcher?.id);
        if (pitcherChanged) {
            const fieldingSide = opponentSide(battingSide(play));
            const appearance = pitcherAppearanceNumber(play, data);
            lines.push(
                `　　${shortTeam(fieldingSide, data)}のマウンドは` +
                `${appearance > 1 ? `${circled(appearance)}人目、` : ""}` +
                `${playerName(play?.matchup?.pitcher, data)}`
            );
        }

        if (isLeadoffPlay) return lines;
        const bases = baseSituation(play, data);
        const situation = `${outSituation(play, data)}、${bases}`;
        lines.push(
            `　　${situation}${order ? `で${circled(order)}番` : "で"}${batter}`
        );
        return lines;
    };
    const priorCount = (play, pitch) => {
        const pitches = pitchEvents(play);
        const index = pitches.indexOf(pitch);
        if (index <= 0) return { balls: 0, strikes: 0 };
        return pitches[index - 1]?.count ?? { balls: 0, strikes: 0 };
    };

    const countText = ({ balls = 0, strikes = 0 } = {}) => {
        const parts = [];
        if (number(balls)) parts.push(`${circled(balls)}ボール`);
        if (number(strikes)) parts.push(`${circled(strikes)}ストライク`);
        return parts.length ? `${parts.join("・")}から` : "";
    };

    // NHK rule: convert mph to km/h, then truncate (never round up) at the
    // second decimal place so the displayed value cannot exceed the fact.
    const speedKph = (mph) => {
        const value = Number(mph);
        if (!Number.isFinite(value)) return "";
        return (Math.floor(value * 1.609344 * 10) / 10).toFixed(1);
    };

    const pitchName = (event) => {
        const code = text(event?.details?.type?.code).toUpperCase();
        return PITCH_NAMES[code] || text(event?.details?.type?.description);
    };

    const pitchLocation = (play, event) => {
        const coordinates = event?.pitchData?.coordinates ?? {};
        const px = Number(coordinates.pX);
        const pz = Number(coordinates.pZ);
        const top = Number(event?.pitchData?.strikeZoneTop);
        const bottom = Number(event?.pitchData?.strikeZoneBottom);
        if (![px, pz, top, bottom].every(Number.isFinite) || top <= bottom) return "";

        const side = text(play?.matchup?.batSide?.code).toUpperCase();
        const horizontalThreshold = 0.28;
        let horizontal = "真ん中";
        if (Math.abs(px) > horizontalThreshold) {
            const inside = side === "L" ? px > 0 : px < 0;
            horizontal = inside ? "内角" : "外角";
        }
        const third = (top - bottom) / 3;
        const vertical = pz >= top - third ? "高め"
            : pz <= bottom + third ? "低め" : "真ん中";
        if (horizontal === "外角" && vertical === "低め") return "アウトローの";
        if (horizontal === "外角" && vertical === "高め") return "アウトハイの";
        if (horizontal === "内角" && vertical === "低め") return "インローの";
        if (horizontal === "内角" && vertical === "高め") return "インハイの";
        if (horizontal === "真ん中" && vertical === "真ん中") return "真ん中の";
        if (horizontal === "真ん中") return `${vertical}の`;
        if (vertical === "真ん中") return `${horizontal}の`;
        return `${horizontal}${vertical}の`;
    };

    const hitDirection = (description) => {
        const value = text(description).toLowerCase();
        if (/right[- ]center field/.test(value)) return "右中間";
        if (/left[- ]center field/.test(value)) return "左中間";
        if (/center field/.test(value)) return "センター";
        if (/right field/.test(value)) return "ライト";
        if (/left field/.test(value)) return "レフト";
        return "";
    };

    const japaneseFocus = (play, data = snapshot()) => {
        const pitcher = play?.matchup?.pitcher;
        const batter = play?.matchup?.batter;
        if (isJapanesePlayer(pitcher, data)) {
            return { role: "pitcher", name: playerName(pitcher, data) };
        }
        if (isJapanesePlayer(batter, data)) {
            return { role: "batter", name: playerName(batter, data) };
        }
        return null;
    };

    const fieldOutText = (play, focus) => {
        const source = `${text(play?.result?.event)} ${text(play?.result?.description)}`.toLowerCase();
        const positions = [
            ["third baseman", "サード"], ["shortstop", "ショート"],
            ["second baseman", "セカンド"], ["first baseman", "ファースト"],
            ["left fielder", "レフト"], ["center fielder", "センター"],
            ["right fielder", "ライト"], ["catcher", "キャッチャー"],
            ["pitcher", "ピッチャー"]
        ];
        const position = positions.find(([english]) => source.includes(english))?.[1] ?? "";
        let result = "アウトに倒れます";
        if (/lineout|lines? out/.test(source)) result = `${position}ライナーに倒れます`;
        else if (/popout|pops? out/.test(source)) {
            result = `${position}${source.includes("foul") ? "ファウル" : ""}フライに倒れます`;
        } else if (/flyout|flies? out/.test(source)) result = `${position}フライに倒れます`;
        else if (/groundout|grounds? out/.test(source)) result = `${position}ゴロに倒れます`;
        if (focus?.role !== "pitcher") return result;
        return `${focus.name}、${result.replace("に倒れます", "に打ち取ります")}`;
    };

    const preferredJapaneseSide = (data = snapshot()) => {
        const boxscore = data?.gameData?.liveData?.boxscore?.teams ?? {};
        const profiles = ["away", "home"].map((side) => {
            const entries = Object.values(boxscore?.[side]?.players ?? {});
            return {
                side,
                japanese: entries.filter((entry) => isJapanesePlayer(entry?.person, data)),
                japanesePitchers: entries.filter((entry) =>
                    isJapanesePlayer(entry?.person, data) &&
                    number(entry?.stats?.pitching?.gamesPlayed) > 0)
            };
        });
        const pitchingSide = profiles.find((profile) => profile.japanesePitchers.length)?.side;
        if (pitchingSide) return pitchingSide;
        return profiles.find((profile) => profile.japanese.length)?.side ?? "";
    };

    const isThreeUpThreeDown = (plays) => plays.length === 3 && plays.every((candidate) => {
        const eventType = text(candidate?.result?.eventType).toLowerCase();
        return eventType.includes("out") || eventType.includes("strikeout");
    });

    const isPitchersFirstThreeUpThreeDown = (play, data = snapshot()) => {
        const inning = number(play?.about?.inning);
        const side = battingSide(play);
        const pitcherId = number(play?.matchup?.pitcher?.id);
        if (!pitcherId || inning <= 1) return false;
        const plays = allPlays(data);
        for (let priorInning = 1; priorInning < inning; priorInning += 1) {
            const priorHalf = plays.filter((candidate) =>
                number(candidate?.about?.inning) === priorInning &&
                battingSide(candidate) === side &&
                number(candidate?.matchup?.pitcher?.id) === pitcherId);
            if (isThreeUpThreeDown(priorHalf)) return false;
        }
        return true;
    };

    const inningClosingLines = (play, data = snapshot()) => {
        if (number(play?.count?.outs) < 3) return [];
        const inning = number(play?.about?.inning);
        const side = battingSide(play);
        const half = allPlays(data).filter((candidate) =>
            number(candidate?.about?.inning) === inning && battingSide(candidate) === side);
        const focus = japaneseFocus(play, data);
        const focusSide = focus?.role === "pitcher"
            ? opponentSide(side)
            : preferredJapaneseSide(data);
        const battingRuns = Math.max(
            0,
            scoreForSide(scoreAfter(play), side) -
            scoreForSide(scoreBefore(half[0] ?? play, data), side)
        );
        const allStrikeouts = half.length === 3 && half.every((candidate) =>
            text(candidate?.result?.eventType).toLowerCase().includes("strikeout"));
        const allRetired = isThreeUpThreeDown(half);
        if (allRetired && isPitchersFirstThreeUpThreeDown(play, data)) {
            const pitcherName = playerName(play?.matchup?.pitcher, data);
            if (pitcherName) {
                return [allStrikeouts
                    ? `　　${pitcherName}、三者連続三振。この試合初めて三者凡退に抑えます`
                    : `　　${pitcherName}、この試合初めて三者凡退に抑えます`];
            }
        }
        if (focusSide === opponentSide(side) && focus?.role === "pitcher") {
            if (allStrikeouts) {
                return [inning === 1
                    ? `　　${focus.name}、三者連続三振。完璧な立ち上がりを見せます`
                    : `　　${focus.name}、三者連続三振で抑えます`];
            }
            if (allRetired) {
                return [inning === 1
                    ? `　　${focus.name}、3人で斬り、上々の立ち上がりです`
                    : `　　${focus.name}、三者凡退に抑えます`];
            }
            if (battingRuns === 0) {
                return [inning === 1
                    ? `　　${focus.name}、無失点で切り抜けます`
                    : `　　${focus.name}、この回も無失点に抑えます`];
            }
        }
        if (focusSide === side && battingRuns === 0) {
            return [`　　${inning === 1 ? "初回" : `${circled(inning)}回`}は無得点に終わります`];
        }
        return [];
    };

    const batterResultLines = (play, detailed, previousSelected, data = snapshot()) => {
        const eventType = text(play?.result?.eventType).toLowerCase();
        const rbi = number(play?.result?.rbi);
        const description = text(play?.result?.description);
        const direction = hitDirection(description);
        const lines = playLeadLines(play, previousSelected, data);
        const scoring = scoringContext(play, data);
        const focus = japaneseFocus(play, data);
        const hitLead = (destination, neutral = destination) => {
            if (!focus?.name) return neutral;
            return focus.role === "pitcher"
                ? `${focus.name}、${destination}運ばれます`
                : `${focus.name}、${destination}`;
        };

        if (detailed) {
            const pitch = finalPitch(play);
            if (pitch) {
                const pitchNumber = number(pitch?.pitchNumber) || pitchEvents(play).length;
                lines.push(`Ｑ　${countText(priorCount(play, pitch))}${circled(pitchNumber)}球目`);
                const location = pitchLocation(play, pitch);
                const speed = speedKph(pitch?.pitchData?.startSpeed);
                const type = pitchName(pitch);
                const pitchDescription = `${location}${speed ? `${speed}キロの` : ""}${type}`;
                if (pitchDescription) {
                    const action = ["home_run", "single", "double", "triple"].includes(eventType)
                        ? "を捉え"
                        : eventType.includes("strikeout")
                            ? /swing|空振/i.test(description) ? "に空振り" : "を見逃し"
                            : "";
                    lines.push(`Ｑ　${pitchDescription}${action}`);
                }
            }
        }

        if (eventType === "home_run") {
            lines.push(`Ｑ　${hitLead(direction ? `${direction}スタンドへ` : "スタンドへ")}`);
            const homeRunLabel = rbi >= 4 ? "グランドスラム"
                : rbi === 3 ? "スリーランホームラン"
                    : rbi === 2 ? "ツーランホームラン" : "ソロホームラン";
            lines.push(`　　${scoring.label ? `${scoring.label}の` : ""}${homeRunLabel}`);
        } else if (eventType === "single") {
            lines.push(`Ｑ　${direction
                ? hitLead(`${direction}へ`)
                : hitLead("ヒットを", "ヒット")}`, "　　シングルヒット");
        } else if (eventType === "double") {
            lines.push(`Ｑ　${direction
                ? hitLead(`${direction}へ`)
                : hitLead("長打を", "大きな当たり")}`, "　　ツーベースヒット");
        } else if (eventType === "triple") {
            lines.push(`Ｑ　${direction
                ? hitLead(`${direction}へ`)
                : hitLead("長打を", "長打コース")}`, "　　スリーベースヒット");
        } else if (eventType.includes("strikeout")) {
            const swinging = /swing|空振/i.test(description);
            const result = swinging ? "空振り三振" : "見逃し三振";
            lines.push(`Ｑ　${focus?.role === "pitcher"
                ? `${focus.name}、${result}を奪います`
                : focus?.role === "batter"
                    ? `${focus.name}は${result}`
                    : result}`);
        } else if (["walk", "intent_walk", "intentional_walk"].includes(eventType)) {
            const batter = playerName(play?.matchup?.batter, data);
            const pitches = pitchEvents(play);
            const straightWalk = eventType === "walk" && pitches.length === 4 &&
                pitches.every((pitch) => pitch?.details?.isBall === true);
            if (straightWalk && focus?.role === "pitcher") {
                lines.push(
                    `Ｑ　${focus.name}、ストライクが入りません`,
                    `　　${batter ? `${batter}を` : ""}ストレートのフォアボールで` +
                        "歩かせてしまいます"
                );
            } else {
                lines.push(`Ｑ　${focus?.role === "pitcher"
                    ? `${focus.name}、${batter ? `${batter}を` : ""}歩かせてしまいます`
                    : focus?.role === "batter"
                        ? `${focus.name}、${straightWalk ? "ストレートの" : ""}` +
                            "フォアボールを選びます"
                        : `${straightWalk ? "ストレートの" : ""}` +
                            "フォアボールで出塁します"}`);
            }
        } else if (eventType === "hit_by_pitch") {
            lines.push("Ｑ　デッドボールで出塁します");
        } else if (eventType.includes("double_play")) {
            lines.push("Ｑ　ダブルプレーに倒れます");
        } else if (eventType === "sac_fly") {
            lines.push(`Ｑ　${direction ? `${direction}への` : ""}犠牲フライ`);
        } else if (["field_error", "error"].includes(eventType)) {
            lines.push("Ｑ　相手のエラーで出塁します");
        } else if (["field_out", "force_out", "ground_out", "other_out"].includes(eventType)) {
            lines.push(`Ｑ　${fieldOutText(play, focus)}`);
        } else {
            lines.push(`Ｑ　${text(play?.result?.event) || description || "打席結果"}`);
        }
        if (scoring.runs) {
            const team = shortTeam(battingSide(play), data);
            const after = scoreAfter(play);
            if (eventType !== "home_run") {
                lines.push(`　　${team}${scoring.label ? `、${scoring.label}` : ""}`);
            }
            lines.push(`　　これで${circled(after.away)}対${circled(after.home)}とします`);
        }
        const closingLines = inningClosingLines(play, data);
        if (closingLines.length && lines.length) {
            const lastIndex = lines.length - 1;
            lines[lastIndex] = lines[lastIndex]
                .replace(/に倒れます$/, "に倒れ")
                .replace(/に打ち取ります$/, "に打ち取り")
                .replace(/三振を奪います$/, "三振を奪い");
        }
        lines.push(...closingLines);
        return lines;
    };

    const starterForSide = (side, data) => {
        const wantedTop = side === "home";
        const play = allPlays(data).find((candidate) =>
            Boolean(candidate?.about?.isTopInning) === wantedTop && candidate?.matchup?.pitcher);
        return play?.matchup?.pitcher ?? null;
    };

    const inningsToOuts = (innings) => {
        const [whole = "0", remainder = "0"] = String(innings ?? "0").split(".");
        return number(whole) * 3 + Math.min(2, number(remainder));
    };

    const inningsLabel = (innings) => {
        const outs = inningsToOuts(innings);
        return `${Math.floor(outs / 3)}${outs % 3 ? `回${outs % 3}/3` : "回"}`;
    };

    const starterGameLogs = async (person, data) => {
        const playerId = number(person?.id);
        const gameDate = text(data?.gameData?.gameData?.datetime?.officialDate);
        const season = number(data?.gameData?.gameData?.game?.season) || number(gameDate.slice(0, 4));
        if (!playerId || !season || !gameDate) return [];
        const key = `${playerId}:${season}:${gameDate}`;
        if (!starterNoteCache.has(key)) {
            const params = new URLSearchParams({
                stats: "gameLog",
                group: "pitching",
                season: String(season),
                gameType: "R,P"
            });
            starterNoteCache.set(key, fetch(
                `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?${params}`
            ).then((response) => {
                if (!response.ok) throw new Error(`MLB Stats API ${response.status}`);
                return response.json();
            }).then((payload) => (payload?.stats ?? [])
                .flatMap((entry) => entry?.splits ?? [])
                .filter((split) => text(split?.date) < gameDate)
                .sort((a, b) => text(b?.date).localeCompare(text(a?.date))))
                .catch(() => []));
        }
        return starterNoteCache.get(key);
    };

    const starterTrendNote = (logs, opponentId) => {
        const starts = logs.filter((split) => number(split?.stat?.gamesStarted) > 0);
        const previous = starts[0];
        if (!previous) return "";
        const stat = previous?.stat ?? {};
        const outs = inningsToOuts(stat?.inningsPitched);
        const runs = number(stat?.runs);
        const earnedRuns = number(stat?.earnedRuns);
        const notes = [];

        if (outs >= 18 && runs <= 2) {
            notes.push(`前回は${inningsLabel(stat?.inningsPitched)}${runs}失点の好投`);
        } else if (runs >= 5) {
            notes.push(`前回は${inningsLabel(stat?.inningsPitched)}${runs}失点と打ち込まれました`);
        } else if (outs <= 6) {
            notes.push(`前回は${inningsLabel(stat?.inningsPitched)}${runs}失点で降板`);
        } else {
            notes.push(`前回は${inningsLabel(stat?.inningsPitched)}${runs}失点`);
        }

        const decisions = logs.filter((split) =>
            number(split?.stat?.wins) > 0 || number(split?.stat?.losses) > 0);
        let winStreak = 0;
        for (const split of decisions) {
            if (number(split?.stat?.wins) <= 0) break;
            winStreak += 1;
        }

        let scorelessOuts = 0;
        for (const split of starts) {
            if (number(split?.stat?.runs) > 0) break;
            scorelessOuts += inningsToOuts(split?.stat?.inningsPitched);
        }

        const versus = starts.filter((split) => number(split?.opponent?.id) === number(opponentId));
        const versusOuts = versus.reduce((sum, split) =>
            sum + inningsToOuts(split?.stat?.inningsPitched), 0);
        const versusEarnedRuns = versus.reduce((sum, split) =>
            sum + number(split?.stat?.earnedRuns), 0);
        const versusWins = versus.reduce((sum, split) => sum + number(split?.stat?.wins), 0);
        const versusLosses = versus.reduce((sum, split) => sum + number(split?.stat?.losses), 0);
        const versusEra = versusOuts ? versusEarnedRuns * 27 / versusOuts : Infinity;

        const scorelessStarts = starts.findIndex((split) => number(split?.stat?.runs) > 0);
        const scorelessGames = scorelessStarts < 0 ? starts.length : scorelessStarts;
        if (scorelessGames >= 2 && scorelessOuts >= 18) {
            notes.push(
                `直近${scorelessGames}試合、合わせて${Math.floor(scorelessOuts / 3)}回` +
                `${scorelessOuts % 3 ? `${scorelessOuts % 3}/3` : ""}無失点です`
            );
        } else if (winStreak >= 2) {
            notes.push(`現在${winStreak}連勝中です`);
        } else if (versus.length >= 2 && versusEra <= 2.5) {
            notes.push(
                `今季この相手には${versusWins}勝${versusLosses}敗、防御率${versusEra.toFixed(2)}と好相性です`
            );
        }
        return notes.join("。");
    };

    const prepareStarterNotes = async (data) => {
        starterNotes.clear();
        if (mode !== "full") return;
        await Promise.all(["away", "home"].map(async (side) => {
            const starter = starterForSide(side, data);
            if (!starter?.id) return;
            const opponentId = number(data?.gameData?.gameData?.teams?.[opponentSide(side)]?.id);
            const logs = await starterGameLogs(starter, data);
            const note = starterTrendNote(logs, opponentId);
            if (note) starterNotes.set(number(starter.id), note);
        }));
    };

    const automaticHead = (selectedPlays, data) => {
        if (["second", "other"].includes(mode)) return [];
        const away = shortTeam("away", data);
        const home = shortTeam("home", data);
        const lines = [`Ｑ　${away}対${home}`];
        const gameType = text(data?.gameData?.gameData?.game?.type).toUpperCase();
        const seriesDescription = text(data?.gameData?.gameData?.game?.seriesDescription);
        const gameNumber = number(data?.gameData?.gameData?.game?.gameNumber);
        if (gameType !== "R" && seriesDescription) {
            lines.push(`　　${seriesDescription}${gameNumber ? `第${circled(gameNumber)}戦` : ""}`);
        } else if (gameNumber > 1) {
            lines.push(`　　連戦の第${circled(gameNumber)}戦`);
        }
        const pregameHighlight = window.PregameInfo?.getGameHighlightText?.(data?.gamePk)?.[0];
        if (pregameHighlight) lines.push(`Ｑ　${pregameHighlight}`);
        const awayStarter = starterForSide("away", data);
        const homeStarter = starterForSide("home", data);
        [["away", away, awayStarter], ["home", home, homeStarter]].forEach(([, team, starter]) => {
            if (!starter || mode !== "full" || !isJapanesePlayer(starter, data)) return;
            lines.push(`Ｑ　${team}先発は${playerName(starter, data)}`);
            const note = starterNotes.get(number(starter.id));
            if (note) lines.push(`　　${note}`);
        });
        if (!selectedPlays.length) lines.push("Ｑ　試合の行方は");
        return lines;
    };

    const starterIntroductionForPlay = (play, introduced, data) => {
        if (mode !== "full") return [];
        const fieldingSide = opponentSide(battingSide(play));
        const starter = starterForSide(fieldingSide, data);
        const pitcherId = number(play?.matchup?.pitcher?.id);
        if (!starter?.id || pitcherId !== number(starter.id) ||
            isJapanesePlayer(starter, data) || introduced.has(pitcherId)) return [];
        introduced.add(pitcherId);
        const lines = [`Ｑ　${shortTeam(fieldingSide, data)}先発は${playerName(starter, data)}`];
        const note = starterNotes.get(pitcherId);
        if (note) lines.push(`　　${note}`);
        return lines;
    };

    const finalLines = (selectedPlays, data) => {
        if (mode !== "full") return [];
        const status = text(data?.gameData?.gameData?.status?.abstractGameState).toLowerCase();
        if (status !== "final") return [];
        const lastPlay = allPlays(data).at(-1);
        const gameEndingSelected = lastPlay && selectedPlays.some((play) =>
            getAtBatIndex(play) === getAtBatIndex(lastPlay));
        if (!gameEndingSelected) return [];
        const teams = data?.gameData?.liveData?.linescore?.teams ?? {};
        const awayRuns = number(teams?.away?.runs);
        const homeRuns = number(teams?.home?.runs);
        if (awayRuns === homeRuns) return [];
        const winner = awayRuns > homeRuns ? shortTeam("away", data) : shortTeam("home", data);
        return [
            `Ｑ　試合は${circled(awayRuns)}対${circled(homeRuns)}`,
            `　　${winner}が勝利しました`
        ];
    };

    const generateNarration = () => {
        const data = snapshot();
        arrangeSelection();
        const selected = selection
            .map((item) => ({ ...item, play: findPlay(item.atBatIndex, data) }))
            .filter((item) => item.play);
        const plays = selected.map((item) => item.play);
        const lines = automaticHead(plays, data);
        const introducedStarters = new Set();
        selected.forEach((item, index) => {
            if (lines.length) lines.push("");
            lines.push(...starterIntroductionForPlay(item.play, introducedStarters, data));
            lines.push(...batterResultLines(
                item.play,
                item.detailed,
                index > 0 ? selected[index - 1].play : null,
                data
            ));
        });
        const ending = finalLines(plays, data);
        if (ending.length) lines.push("", ...ending);
        return lines.join("\n");
    };

    const refreshMarks = () => {
        document.querySelectorAll(".highlight-script-selected").forEach((cell) => {
            cell.classList.remove("highlight-script-selected", "highlight-script-detailed");
            cell.querySelector(".highlight-script-order")?.remove();
        });
        selection.forEach((item, index) => {
            const cell = document.querySelector(
                `.atbat-cell[data-at-bat-index="${item.atBatIndex}"]`
            );
            if (!cell) return;
            cell.classList.add("highlight-script-selected");
            if (item.detailed) cell.classList.add("highlight-script-detailed");
            const badge = document.createElement("span");
            badge.className = "highlight-script-order";
            badge.textContent = String(index + 1);
            cell.append(badge);
        });
        toolbar?.querySelector("[data-count]")?.replaceChildren(
            document.createTextNode(`${selection.length}件選択中`)
        );
    };

    const selectCell = (cell, detailed = false) => {
        const atBatIndex = Number(cell?.dataset?.atBatIndex);
        if (!Number.isInteger(atBatIndex)) return;
        const index = selection.findIndex((item) => item.atBatIndex === atBatIndex);
        if (detailed) {
            if (index < 0) selection.push({
                atBatIndex,
                detailed: true,
                selectionOrder: selectionSequence++
            });
            else selection[index].detailed = true;
        } else if (index < 0) {
            selection.push({
                atBatIndex,
                detailed: false,
                selectionOrder: selectionSequence++
            });
        } else {
            selection.splice(index, 1);
        }
        arrangeSelection();
        refreshMarks();
    };

    const stop = ({ clear = false } = {}) => {
        active = false;
        document.body.classList.remove("highlight-selection-active");
        toolbar?.remove();
        toolbar = null;
        if (clear) {
            selection.splice(0);
            refreshMarks();
        }
    };

    const makeToolbar = () => {
        const element = document.createElement("section");
        element.className = "highlight-script-toolbar";
        element.innerHTML = `
            <div class="highlight-script-drag-handle" data-drag>
                <span>ここをドラッグして移動</span>
                <button type="button" data-collapse>しまう</button>
            </div>
            <div class="highlight-script-toolbar-row">
                <label>原稿形式
                    <select data-mode>
                        ${Object.entries(MODES).map(([value, label]) =>
                            `<option value="${value}">${label}</option>`).join("")}
                    </select>
                </label>
                <strong data-count>0件選択中</strong>
            </div>
            <p>クリック：採用／解除　ダブルクリック：球数・球種・コースまで詳しく</p>
            <div class="highlight-script-toolbar-actions">
                <button type="button" data-cancel>キャンセル</button>
                <button type="button" data-finish class="primary">選択終了</button>
            </div>`;
        element.querySelector("[data-mode]").value = mode;
        element.querySelector("[data-mode]").addEventListener("change", (event) => {
            mode = event.target.value;
            arrangeSelection();
            refreshMarks();
        });
        element.querySelector("[data-collapse]").addEventListener("click", (event) => {
            event.stopPropagation();
            const collapsed = element.classList.toggle("is-collapsed");
            event.currentTarget.textContent = collapsed ? "開く" : "しまう";
        });
        element.querySelector("[data-cancel]").addEventListener("click", () => stop({ clear: true }));
        element.querySelector("[data-finish]").addEventListener("click", finish);
        const dragHandle = element.querySelector("[data-drag]");
        dragHandle.addEventListener("pointerdown", (event) => {
            if (event.target.closest("button")) return;
            event.preventDefault();
            dragHandle.setPointerCapture(event.pointerId);
            const startRect = element.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const move = (moveEvent) => {
                const maxLeft = Math.max(0, window.innerWidth - startRect.width);
                const maxTop = Math.max(0, window.innerHeight - startRect.height);
                element.style.left = `${Math.min(maxLeft, Math.max(0, startRect.left + moveEvent.clientX - startX))}px`;
                element.style.top = `${Math.min(maxTop, Math.max(0, startRect.top + moveEvent.clientY - startY))}px`;
                element.style.right = "auto";
            };
            const end = () => {
                dragHandle.removeEventListener("pointermove", move);
                dragHandle.removeEventListener("pointerup", end);
                dragHandle.removeEventListener("pointercancel", end);
            };
            dragHandle.addEventListener("pointermove", move);
            dragHandle.addEventListener("pointerup", end);
            dragHandle.addEventListener("pointercancel", end);
        });
        document.body.append(element);
        toolbar = element;
    };

    const crcTable = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    const crc32 = (bytes) => {
        let crc = 0xffffffff;
        bytes.forEach((byte) => { crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
        return (crc ^ 0xffffffff) >>> 0;
    };

    const little = (size, ...values) => {
        const bytes = new Uint8Array(size * values.length);
        const view = new DataView(bytes.buffer);
        values.forEach((value, index) => {
            if (size === 2) view.setUint16(index * size, value, true);
            else view.setUint32(index * size, value >>> 0, true);
        });
        return bytes;
    };
    const joinBytes = (parts) => {
        const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        parts.forEach((part) => { output.set(part, offset); offset += part.length; });
        return output;
    };

    const makeZip = (entries) => {
        const localParts = [];
        const centralParts = [];
        let offset = 0;
        entries.forEach(({ name, content }) => {
            const nameBytes = encoder.encode(name);
            const data = encoder.encode(content);
            const crc = crc32(data);
            const local = joinBytes([
                little(4, 0x04034b50), little(2, 20, 0, 0, 0, 0),
                little(4, crc, data.length, data.length), little(2, nameBytes.length, 0),
                nameBytes, data
            ]);
            const central = joinBytes([
                little(4, 0x02014b50), little(2, 20, 20, 0, 0, 0, 0),
                little(4, crc, data.length, data.length), little(2, nameBytes.length, 0, 0, 0, 0),
                little(4, 0, offset), nameBytes
            ]);
            localParts.push(local);
            centralParts.push(central);
            offset += local.length;
        });
        const central = joinBytes(centralParts);
        return joinBytes([
            ...localParts,
            central,
            little(4, 0x06054b50), little(2, 0, 0, entries.length, entries.length),
            little(4, central.length, offset), little(2, 0)
        ]);
    };

    const documentXml = (narration) => {
        const paragraphs = narration.split(/\r?\n/).map((line) => line
            ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/></w:pPr>` +
                `<w:r><w:rPr><w:rFonts w:ascii="ＭＳ ゴシック" w:eastAsia="ＭＳ ゴシック"/>` +
                `<w:sz w:val="54"/><w:szCs w:val="54"/></w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`
            : "<w:p/>").join("");
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs}<w:sectPr><w:footerReference w:type="default" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:headerReference w:type="default" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="2835" w:bottom="850" w:left="850" w:header="360" w:footer="720" w:gutter="0"/><w:textDirection w:val="tbRl"/><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:body></w:document>`;
    };

    const headerXml = ({ away = "", home = "", author = "平本" } = {}) => {
        // 番組の放送順を人間が書き換える欄。試合日付ではないため固定値にする。
        const itemNumber = "⑥1";
        const matchup = away && home ? `${away}@${home}` : "";
        const label = [itemNumber, matchup, author].filter(Boolean).join("　");
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:tbl><w:tblPr><w:tblW w:w="840" w:type="dxa"/><w:jc w:val="right"/><w:tblLayout w:type="fixed"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="840"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="8500" w:hRule="atLeast"/></w:trPr>
<w:tc><w:tcPr><w:tcW w:w="840" w:type="dxa"/><w:textDirection w:val="tbRl"/><w:vAlign w:val="center"/><w:tcBorders><w:top w:val="single" w:sz="6" w:color="888888"/><w:left w:val="single" w:sz="6" w:color="888888"/><w:bottom w:val="single" w:sz="6" w:color="888888"/><w:right w:val="single" w:sz="6" w:color="888888"/></w:tcBorders></w:tcPr>
<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="ＭＳ ゴシック" w:eastAsia="ＭＳ ゴシック"/><w:color w:val="777777"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t xml:space="preserve">${xml(label)}</w:t></w:r></w:p>
</w:tc></w:tr></w:tbl><w:p/></w:hdr>`;
    };

    const makeDocx = (narration, metadata = {}) => makeZip([
        { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>` },
        { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
        { name: "word/document.xml", content: documentXml(narration) },
        { name: "word/styles.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="ＭＳ ゴシック" w:eastAsia="ＭＳ ゴシック"/><w:sz w:val="54"/><w:szCs w:val="54"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>` },
        { name: "word/settings.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:compat/></w:settings>` },
        { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>` },
        { name: "word/header1.xml", content: headerXml(metadata) },
        { name: "word/footer1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>/</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>` }
    ]);

    const downloadDocx = (narration) => {
        const data = snapshot();
        const date = text(data?.gameData?.gameData?.datetime?.officialDate).replaceAll("-", "");
        const away = text(data?.away?.abbreviation || "AWAY");
        const home = text(data?.home?.abbreviation || "HOME");
        const filename = `${date || "highlight"}_${away}-${home}_NA原稿.docx`;
        const blob = new Blob([makeDocx(narration, {
            away,
            home,
            author: "平本"
        })], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        context()?.setStatus?.(`${filename} を出力しました。`);
    };

    const showPreview = (narration) => {
        dialog?.remove();
        const backdrop = document.createElement("div");
        backdrop.className = "highlight-script-dialog-backdrop";
        backdrop.innerHTML = `<section class="highlight-script-dialog" role="dialog" aria-modal="true" aria-label="ハイライト原稿プレビュー"><header><h2>ハイライト原稿</h2><button type="button" data-close aria-label="閉じる">閉じる</button></header><p class="highlight-script-dialog-note">実況・解説や映像指示は入れていません。必要に応じて本文を直してからWordへ出力できます。</p><textarea spellcheck="false"></textarea><footer><button type="button" data-reselect>選び直す</button><button type="button" data-download class="primary">Wordを出力</button></footer></section>`;
        const textarea = backdrop.querySelector("textarea");
        textarea.value = narration;
        backdrop.querySelector("[data-close]").addEventListener("click", () => {
            backdrop.remove();
            dialog = null;
            selection.splice(0);
            refreshMarks();
        });
        backdrop.querySelector("[data-reselect]").addEventListener("click", () => {
            backdrop.remove();
            dialog = null;
            start({ preserve: true });
        });
        backdrop.querySelector("[data-download]").addEventListener("click", () =>
            downloadDocx(textarea.value));
        document.body.append(backdrop);
        dialog = backdrop;
        textarea.focus();
    };

    async function finish() {
        if (!selection.length) {
            context()?.setStatus?.("原稿に使う打席を1つ以上選択してください。", true);
            return;
        }
        const finishButton = toolbar?.querySelector("[data-finish]");
        if (finishButton) {
            finishButton.disabled = true;
            finishButton.textContent = "先発情報を確認中…";
        }
        context()?.setStatus?.("MLB公式データで先発投手の直近成績を確認しています。");
        await prepareStarterNotes(snapshot());
        const narration = generateNarration();
        stop();
        context()?.setStatus?.("先発投手の直近情報を反映して原稿を作成しました。");
        showPreview(narration);
    }

    function start({ preserve = false } = {}) {
        const data = snapshot();
        if (!data?.gamePk || !data?.gameData) {
            context()?.setStatus?.("先に試合データを読み込んでください。", true);
            return;
        }
        if (!preserve) selection.splice(0);
        active = true;
        document.body.classList.add("highlight-selection-active");
        toolbar?.remove();
        makeToolbar();
        refreshMarks();
    }

    document.addEventListener("click", (event) => {
        if (!active) return;
        const cell = event.target.closest?.(".atbat-cell[data-at-bat-index]");
        if (!cell) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.detail > 1) return;
        selectCell(cell, false);
    }, true);

    document.addEventListener("dblclick", (event) => {
        if (!active) return;
        const cell = event.target.closest?.(".atbat-cell[data-at-bat-index]");
        if (!cell) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        selectCell(cell, true);
    }, true);

    window.ScorebookHighlightScript = {
        start,
        speedKph,
        summarizeStarterLogs: starterTrendNote,
        buildDocx: makeDocx,
        buildNarration: (items, requestedMode = "full") => {
            const previousMode = mode;
            const previousSelection = selection.map((item) => ({ ...item }));
            mode = MODES[requestedMode] ? requestedMode : "full";
            selection.splice(0, selection.length, ...(items ?? []).map((item, index) => ({
                atBatIndex: Number(item.atBatIndex),
                detailed: Boolean(item.detailed),
                selectionOrder: index
            })));
            arrangeSelection();
            const narration = generateNarration();
            mode = previousMode;
            selection.splice(0, selection.length, ...previousSelection);
            return narration;
        }
    };
})();
