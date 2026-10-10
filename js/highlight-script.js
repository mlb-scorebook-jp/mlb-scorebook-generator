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
            : (a, b) => Number(a.timelineIndex ?? a.atBatIndex) -
                Number(b.timelineIndex ?? b.atBatIndex));
    };
    let active = false;
    let mode = "full";
    let toolbar = null;
    let dialog = null;
    const starterNoteCache = new Map();
    const gameFeedCache = new Map();
    const starterNotes = new Map();
    const relieverNotes = new Map();
    const relieverRematches = new Set();

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
    const findPitcherChange = (incomingPitcherId, data = snapshot()) => {
        for (const play of allPlays(data)) {
            const event = (play?.playEvents ?? []).find((candidate) =>
                text(candidate?.details?.eventType).toLowerCase() === "pitching_substitution" &&
                number(candidate?.player?.id) === number(incomingPitcherId));
            if (event) return { play, event };
        }
        const play = allPlays(data).find((candidate) =>
            number(candidate?.matchup?.pitcher?.id) === number(incomingPitcherId));
        return play ? { play, event: null } : null;
    };
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
        if (number(play?.about?.inning) === 1 && half === "表") return "初回";
        return `${circled(play?.about?.inning)}回${half}`;
    };

    const halfInningIndex = (play) => {
        const inning = number(play?.about?.inning);
        const isBottom = !(play?.about?.isTopInning === true ||
            text(play?.about?.halfInning).toLowerCase() === "top");
        return Math.max(0, (inning - 1) * 2 + (isBottom ? 1 : 0));
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
        if (occupied.length === 3) return "満塁";
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

    const matchupNumber = (play, data = snapshot()) => {
        const position = playPosition(play, data);
        const pitcherId = number(play?.matchup?.pitcher?.id);
        const batterId = number(play?.matchup?.batter?.id);
        if (position < 0 || !pitcherId || !batterId) return 1;
        return allPlays(data).slice(0, position + 1).filter((candidate) =>
            number(candidate?.matchup?.pitcher?.id) === pitcherId &&
            number(candidate?.matchup?.batter?.id) === batterId).length;
    };

    const skippedScoringLead = (previousSelected, play, data = snapshot()) => {
        if (!previousSelected) return "";
        const start = playPosition(previousSelected, data);
        const end = playPosition(play, data);
        if (start < 0 || end <= start + 1) return "";
        const scoringPlays = allPlays(data).slice(start + 1, end)
            .filter((candidate) => scoringContext(candidate, data).runs > 0);
        if (!scoringPlays.length) return "";
        if (scoringPlays.length === 1) {
            const scoringPlay = scoringPlays[0];
            const runs = scoringContext(scoringPlay, data).runs;
            const eventType = text(scoringPlay?.result?.eventType).toLowerCase();
            const batter = playerName(scoringPlay?.matchup?.batter, data);
            const event = eventType === "home_run" ? "ホームラン"
                : ["single", "double", "triple"].includes(eventType) ? "タイムリー"
                    : eventType === "sac_fly" ? "犠牲フライ"
                        : eventType === "walk" ? "押し出しのフォアボール"
                            : eventType === "hit_by_pitch" ? "押し出しのデッドボール"
                                : "一打";
            return `このあと${batter ? `${batter}の` : ""}${event}で` +
                `${runs === 1 ? "もう①点" : `さらに${circled(runs)}点`}を追加`;
        }
        const scoringSides = [...new Set(scoringPlays.map((candidate) => battingSide(candidate)))];
        if (scoringSides.length > 1) return "このあと両チームに得点が入り";
        const addedRuns = scoringPlays.reduce((total, candidate) =>
            total + scoringContext(candidate, data).runs, 0);
        return `このあと${shortTeam(scoringSides[0], data)}がさらに${circled(addedRuns)}点を追加`;
    };

    const unshownHalfClosingLines = (previousSelected, currentPlay, data = snapshot()) => {
        if (!previousSelected || !currentPlay ||
            halfInningIndex(currentPlay) <= halfInningIndex(previousSelected) ||
            number(previousSelected?.count?.outs) >= 3) return [];
        const inning = number(previousSelected?.about?.inning);
        const side = battingSide(previousSelected);
        const half = allPlays(data).filter((candidate) =>
            number(candidate?.about?.inning) === inning && battingSide(candidate) === side);
        const last = half.at(-1);
        if (!last || number(last?.count?.outs) < 3) return [];
        const preferredSide = preferredJapaneseSide(data);
        const runsAtSelection = scoreForSide(scoreAfter(previousSelected), side);
        const runsAtEnd = scoreForSide(scoreAfter(last), side);
        const halfRuns = runsAtEnd - scoreForSide(scoreBefore(half[0], data), side);
        if (preferredSide === side && halfRuns === 0) {
            return ["　　しかし後が続かず", `　　${shortTeam(side, data)}無得点に終わります`];
        }
        const pitcherId = number(previousSelected?.matchup?.pitcher?.id);
        if (preferredSide === opponentSide(side) && runsAtEnd === runsAtSelection &&
            number(last?.matchup?.pitcher?.id) === pitcherId) {
            const pitcher = playerName(previousSelected?.matchup?.pitcher, data);
            return pitcher ? [`　　${pitcher}、このあと後続も抑えます`] : [];
        }
        return [];
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
        const halfInningGap = previousSelected
            ? halfInningIndex(play) - halfInningIndex(previousSelected)
            : 0;
        const skipsAtLeastFourHalfInnings = halfInningGap >= 4;
        const movesToBottom = previousSelected && previousSide === "away" &&
            currentSide === "home" && previousInning === currentInning;
        const movesToNextTop = previousSelected && previousSide === "home" &&
            currentSide === "away" && currentInning === previousInning + 1;
        const consecutive = previousSelected &&
            playPosition(play, data) === playPosition(previousSelected, data) + 1;
        const order = battingOrder(play, data);
        const batter = playerName(play?.matchup?.batter, data) || "打者";
        const meeting = matchupNumber(play, data);
        const japaneseMatchup = isJapanesePlayer(play?.matchup?.pitcher, data) &&
            isJapanesePlayer(play?.matchup?.batter, data);
        const batterLabel = `${order ? `${circled(order)}番` : ""}${batter}` +
            `${japaneseMatchup && meeting > 1 ? `と${circled(meeting)}度目の対決` : ""}`;
        const firstPlayOfHalf = allPlays(data).find((candidate) =>
            number(candidate?.about?.inning) === currentInning &&
            battingSide(candidate) === currentSide);
        const isLeadoffPlay = firstPlayOfHalf === play;
        const battingTeam = shortTeam(currentSide, data);
        const bases = baseSituation(play, data);
        const continuedBasesLoadedThreat = consecutive && bases === "満塁" &&
            scoringContext(previousSelected, data).runs > 0;
        const japaneseSide = preferredJapaneseSide(data);
        const skippedScore = skippedScoringLead(previousSelected, play, data);
        if (skippedScore) {
            if (sameInning) {
                lines.push(`Ｑ　${skippedScore}`);
            } else {
                const score = scoreBefore(play, data);
                const connector = skippedScore.endsWith("入り") ? "、" : "し、";
                lines.push(
                    `Ｑ　${skippedScore}${connector}${circled(score.away)}対${circled(score.home)}` +
                    `で迎えた${inningLabel(play)}`
                );
                if (isLeadoffPlay) {
                    lines.push(`　　${battingTeam}は${batterLabel}`);
                }
            }
        } else if (isLeadoffPlay && movesToBottom) {
            lines.push(`Ｑ　その裏、${battingTeam}は${batterLabel}`);
        } else if (isLeadoffPlay && movesToNextTop) {
            lines.push(
                `Ｑ　直後の${circled(currentInning)}回表、` +
                `${battingTeam}は${batterLabel}`
            );
        } else if (movesToBottom) lines.push("Ｑ　その裏");
        else if (movesToNextTop) lines.push(`Ｑ　直後の${circled(currentInning)}回表`);
        else if (!sameInning) {
            if (skipsAtLeastFourHalfInnings) {
                const score = scoreBefore(play, data);
                lines.push(score.away === 0 && score.home === 0
                    ? `Ｑ　両チーム無得点のまま迎えた${inningLabel(play)}`
                    : `Ｑ　${circled(score.away)}対${circled(score.home)}で迎えた${inningLabel(play)}`);
            } else {
                lines.push(`Ｑ　${inningLabel(play)}`);
            }
            if (isLeadoffPlay) {
                lines.push(`　　${battingTeam}は${batterLabel}`);
            }
        }
        else if (continuedBasesLoadedThreat) {
            lines.push(japaneseSide === currentSide
                ? "Ｑ　まだ満塁のチャンスは続きます"
                : "Ｑ　まだ満塁のピンチは続きます");
        }
        else if (consecutive) {
            // 接続語を置かず、そのまま次の打席状況へつなぐ。
        }
        else lines.push("Ｑ　この後");

        const pitcherChanged = previousSelected &&
            battingSide(previousSelected) === battingSide(play) &&
            number(previousSelected?.matchup?.pitcher?.id) !== number(play?.matchup?.pitcher?.id);
        if (pitcherChanged) {
            const outgoing = playerName(previousSelected?.matchup?.pitcher, data);
            const incoming = playerName(play?.matchup?.pitcher, data);
            lines.push(outgoing && incoming
                ? `　　ここで${outgoing}に代えて${incoming}をマウンドへ`
                : `　　${incoming || "新しいピッチャー"}がマウンドに上がります`);
            const note = relieverNotes.get(number(play?.matchup?.pitcher?.id));
            if (note) lines.push(`　　${note}`);
        }

        if (isLeadoffPlay) return lines;
        if (continuedBasesLoadedThreat) {
            lines.push(`　　${batterLabel}`);
            return lines;
        }
        const situation = `${outSituation(play, data)}${bases}`;
        lines.push(
            `${consecutive ? "Ｑ　" : "　　"}${situation}` +
            `で${batterLabel}`
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
        if (!parts.length) return "";
        return `${parts.join("")}${parts.length > 1 ? "となって" : "から"}`;
    };

    // NHK rule: convert mph to km/h, then truncate (never round up) at the
    // second decimal place so the displayed value cannot exceed the fact.
    const speedKph = (mph) => {
        const value = Number(mph);
        if (!Number.isFinite(value)) return "";
        const truncated = Math.floor(value * 1.609344 * 10) / 10;
        return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1);
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

    const DETAIL_EVENT_TYPES = new Set([
        "stolen_base_2b", "stolen_base_3b", "stolen_base_home",
        "wild_pitch", "passed_ball", "balk", "caught_stealing_2b",
        "caught_stealing_3b", "caught_stealing_home", "pickoff_1b",
        "pickoff_2b", "pickoff_3b"
    ]);

    const detailEventLabel = (event) => {
        const eventType = text(event?.details?.eventType).toLowerCase();
        if (eventType.startsWith("stolen_base")) return "盗塁";
        if (eventType.startsWith("caught_stealing")) return "盗塁死";
        if (eventType.startsWith("pickoff")) return "けん制アウト";
        if (eventType === "wild_pitch") return "ワイルドピッチ";
        if (eventType === "passed_ball") return "パスボール";
        if (eventType === "balk") return "ボーク";
        return text(event?.details?.description || event?.details?.event);
    };

    const detailOptions = (play, data = snapshot()) => {
        const pitches = pitchEvents(play).map((pitch, index) => ({
            key: `pitch:${number(pitch?.pitchNumber) || index + 1}`,
            label: `${number(pitch?.pitchNumber) || index + 1}球目`,
            kind: "pitch",
            event: pitch
        }));
        const actions = (play?.playEvents ?? []).filter((event) =>
            DETAIL_EVENT_TYPES.has(text(event?.details?.eventType).toLowerCase()))
            .map((event, index) => {
                const pitchNumber = number(event?.pitchNumber) ||
                    number((play?.playEvents ?? [])
                        .filter((candidate) => candidate?.isPitch &&
                            number(candidate?.index) < number(event?.index))
                        .at(-1)?.pitchNumber);
                return {
                    key: `event:${number(event?.index) || index}`,
                    label: `${detailEventLabel(event)}${pitchNumber ? `（${pitchNumber}球目）` : ""}`,
                    kind: "event",
                    event
                };
            });
        return [...pitches, ...actions];
    };

    const baseLabel = (base) => ({ "1B": "一塁", "2B": "二塁", "3B": "三塁",
        score: "ホーム", "4B": "ホーム" })[text(base)] || text(base);

    const runnerMovementsForEvent = (play, event) => (play?.runners ?? []).filter((runner) =>
        number(runner?.details?.playIndex) === number(event?.index));

    const detailEventLines = (play, option, data = snapshot()) => {
        const event = option?.event;
        const sourcePlay = option?.sourcePlay ?? play;
        const eventType = text(event?.details?.eventType).toLowerCase();
        const pitchNumber = number(event?.pitchNumber) ||
            number((sourcePlay?.playEvents ?? [])
                .filter((candidate) => candidate?.isPitch &&
                    number(candidate?.index) < number(event?.index))
                .at(-1)?.pitchNumber);
        const prefix = pitchNumber ? `${circled(pitchNumber)}球目、` : "";
        const eventMovements = runnerMovementsForEvent(sourcePlay, event);
        const movements = eventType.startsWith("stolen_base") && option?.runnerId
            ? eventMovements.filter((movement) =>
                number(movement?.details?.runner?.id) === number(option.runnerId))
            : eventMovements;
        if (eventType.startsWith("stolen_base")) {
            const movement = movements[0];
            const runner = playerName(movement?.details?.runner, data) || "ランナー";
            const start = baseLabel(movement?.movement?.start);
            return [`Ｑ　${prefix}${start ? `${start}ランナー` : "ランナー"}${runner}がスタート`];
        }
        if (eventType === "wild_pitch" || eventType === "passed_ball" || eventType === "balk") {
            const label = eventType === "wild_pitch" ? "ワイルドピッチ"
                : eventType === "passed_ball" ? "パスボール" : "ボーク";
            const destinations = [...new Set(movements
                .filter((runner) => !runner?.movement?.isOut)
                .map((runner) => baseLabel(runner?.movement?.end))
                .filter(Boolean))];
            return [
                `Ｑ　${prefix}${label}でランナーが進塁`,
                ...(destinations.length ? [`　　${destinations.join("、")}になります`] : [])
            ];
        }
        const description = text(event?.details?.description || event?.details?.event);
        return description ? [`Ｑ　${prefix}${description}`] : [];
    };

    const isSuccessfulFiremanEntry = (play, data = snapshot()) => {
        const pitcherId = number(play?.matchup?.pitcher?.id);
        if (!pitcherId || pitcherAppearanceNumber(play, data) <= 1) return false;
        const firstPlay = allPlays(data).find((candidate) =>
            number(candidate?.matchup?.pitcher?.id) === pitcherId);
        if (firstPlay !== play || baseSituation(play, data) === "ランナーなし") return false;
        const eventType = text(play?.result?.eventType).toLowerCase();
        const retired = eventType.includes("out") || eventType.includes("strikeout") ||
            eventType.includes("double_play");
        return retired && scoringContext(play, data).runs === 0 && number(play?.count?.outs) >= 3;
    };

    const batterResultLines = (play, detailKeys, previousSelected, data = snapshot()) => {
        const eventType = text(play?.result?.eventType).toLowerCase();
        const rbi = number(play?.result?.rbi);
        const description = text(play?.result?.description);
        const direction = hitDirection(description);
        const lines = playLeadLines(play, previousSelected, data);
        const scoring = scoringContext(play, data);
        const focus = japaneseFocus(play, data);
        const rematchKey = `${number(play?.matchup?.pitcher?.id)}:${number(play?.matchup?.batter?.id)}`;
        const wonYesterdayRematch = relieverRematches.has(rematchKey) &&
            ["home_run", "single", "double", "triple"].includes(eventType);
        const hitLead = (destination, neutral = destination) => {
            if (!focus?.name) return neutral;
            return focus.role === "pitcher"
                ? `${focus.name}、${destination}運ばれます`
                : `${focus.name}、${destination}`;
        };

        const selectedDetails = new Set(Array.isArray(detailKeys) ? detailKeys : []);
        detailOptions(play).filter((option) => selectedDetails.has(option.key))
            .forEach((option) => {
            if (option.kind === "pitch") {
                const pitch = option.event;
                const pitchNumber = number(pitch?.pitchNumber) || pitchEvents(play).length;
                lines.push(`Ｑ　${pitchNumber === 1
                    ? "初球"
                    : `${countText(priorCount(play, pitch))}${circled(pitchNumber)}球目`}`);
                const location = pitchLocation(play, pitch);
                const speed = speedKph(pitch?.pitchData?.startSpeed);
                const type = pitchName(pitch);
                const pitchDescription = `${location}${speed ? `${speed}キロの` : ""}${type}`;
                if (pitchDescription) {
                    const isFinalPitch = pitch === finalPitch(play);
                    const action = isFinalPitch && ["home_run", "single", "double", "triple"].includes(eventType)
                        ? focus?.role === "pitcher" ? "を捉えられ" : "を捉え"
                        : isFinalPitch && eventType.includes("strikeout")
                            ? /swing|空振/i.test(description) ? "に空振り" : "を見逃し"
                            : "";
                    lines.push(`Ｑ　${pitchDescription}${action}`);
                }
            } else {
                lines.push(...detailEventLines(play, option, data));
            }
        });

        if (eventType === "home_run") {
            lines.push(`Ｑ　${hitLead(direction ? `${direction}スタンドへ` : "スタンドへ")}`);
            const homeRunLabel = rbi >= 4 ? "グランドスラム"
                : rbi === 3 ? "スリーランホームラン"
                    : rbi === 2 ? "ツーランホームラン" : "ソロホームラン";
            lines.push(`　　${focus?.role !== "pitcher" && scoring.label
                ? `${scoring.label}の`
                : ""}${homeRunLabel}`);
        } else if (eventType === "single") {
            if (focus?.role === "pitcher") {
                lines.push(`Ｑ　${focus.name}、${direction ? `${direction}へ運ばれ、` : ""}ヒットを許します`);
            } else {
                lines.push(`Ｑ　${direction
                    ? hitLead(`${direction}へ`)
                    : hitLead("ヒットを", "ヒット")}`, "　　シングルヒット");
            }
        } else if (eventType === "double") {
            if (focus?.role === "pitcher") {
                lines.push(`Ｑ　${focus.name}、${direction ? `${direction}へ運ばれ、` : ""}長打を許します`);
            } else {
                lines.push(`Ｑ　${direction
                    ? hitLead(`${direction}へ`)
                    : hitLead("長打を", "大きな当たり")}`, "　　ツーベースヒット");
            }
        } else if (eventType === "triple") {
            if (focus?.role === "pitcher") {
                lines.push(`Ｑ　${focus.name}、${direction ? `${direction}へ運ばれ、` : ""}長打を許します`);
            } else {
                lines.push(`Ｑ　${direction
                    ? hitLead(`${direction}へ`)
                    : hitLead("長打を", "長打コース")}`, "　　スリーベースヒット");
            }
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
            const becomesBasesLoaded = ["③塁・②塁", "③塁・①塁", "②塁・①塁"]
                .includes(baseSituation(play, data));
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
            if (becomesBasesLoaded) lines.push("　　これで満塁とします");
        } else if (eventType === "hit_by_pitch") {
            const batter = playerName(play?.matchup?.batter, data);
            lines.push(`Ｑ　${focus?.role === "pitcher"
                ? `${focus.name}、${batter ? `${batter}に` : ""}デッドボールを与えます`
                : focus?.role === "batter"
                    ? `${focus.name}、デッドボールで出塁します`
                    : "デッドボールで出塁します"}`);
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
        if (wonYesterdayRematch) {
            const batter = playerName(play?.matchup?.batter, data);
            if (batter) lines.push(`　　今日は${batter}が仕留めました`);
        }
        if (scoring.runs) {
            const team = shortTeam(battingSide(play), data);
            const preferredSide = preferredJapaneseSide(data);
            const after = scoreAfter(play);
            if (preferredSide === opponentSide(battingSide(play))) {
                const preferredTeam = shortTeam(preferredSide, data);
                const allowed = scoring.label === "先制" ? "先制を許します"
                    : scoring.label === "同点" ? "追いつかれます"
                        : scoring.label === "逆転" ? "逆転を許します"
                            : scoring.label === "勝ち越し" ? "勝ち越しを許します"
                                : scoring.label === "追加点" ? "追加点を許します"
                                    : "反撃を許します";
                lines.push(`　　${preferredTeam}、${allowed}`);
            } else if (eventType !== "home_run") {
                lines.push(`　　${team}${scoring.label ? `、${scoring.label}` : ""}`);
            }
            lines.push(`　　これで${circled(after.away)}対${circled(after.home)}とします`);
        }
        const firemanSuccess = isSuccessfulFiremanEntry(play, data);
        if (firemanSuccess) {
            const lastResult = lines.findLastIndex((line) => line.startsWith("Ｑ　"));
            if (lastResult >= 0) {
                lines[lastResult] = lines[lastResult]
                    .replace(/に倒れます$/, "！")
                    .replace(/に打ち取ります$/, "！");
            }
            lines.push("　　ピンチで火消しに成功します");
        }
        const closingLines = firemanSuccess ? [] : inningClosingLines(play, data);
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

    const gameLogOpponentName = (split) => {
        const opponent = split?.opponent ?? {};
        const opponentId = number(opponent?.id);
        const abbreviation = text(
            opponent?.abbreviation || window.MLB_SCOREBOOK_TEAM_CODES_BY_ID?.[opponentId]
        ).toUpperCase();
        return TEAM_SHORT_NAMES[abbreviation] ||
            text(window.MLB_SCOREBOOK_TEAM_NAMES_BY_ID?.[opponentId]);
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
        const previousOpponent = gameLogOpponentName(previous);
        const previousLead = previousOpponent ? `前回の${previousOpponent}戦では` : "前回は";

        if (outs >= 18 && runs <= 2) {
            notes.push(`${previousLead}${inningsLabel(stat?.inningsPitched)}${runs}失点の好投`);
        } else if (runs >= 5) {
            notes.push(`${previousLead}${inningsLabel(stat?.inningsPitched)}${runs}失点と打ち込まれました`);
        } else if (outs <= 6) {
            notes.push(`${previousLead}${inningsLabel(stat?.inningsPitched)}${runs}失点で降板`);
        } else {
            notes.push(`${previousLead}${inningsLabel(stat?.inningsPitched)}${runs}失点`);
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

    const gameFeed = async (gamePk) => {
        if (!gamePk) return null;
        if (!gameFeedCache.has(gamePk)) {
            gameFeedCache.set(gamePk, fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`)
                .then((response) => response.ok ? response.json() : null)
                .catch(() => null));
        }
        return gameFeedCache.get(gamePk);
    };

    const relieverTrendNote = async (logs, gameDate, currentPlay, data) => {
        const appearances = logs.filter((split) => number(split?.stat?.gamesPlayed) > 0);
        if (!appearances.length) return "";
        const dateBefore = (days) => {
            const date = new Date(`${gameDate}T12:00:00Z`);
            date.setUTCDate(date.getUTCDate() - days);
            return date.toISOString().slice(0, 10);
        };
        if (text(appearances[0]?.date) === dateBefore(1)) {
            const pitcherId = number(currentPlay?.matchup?.pitcher?.id);
            const batterId = number(currentPlay?.matchup?.batter?.id);
            const previousGamePk = number(
                appearances[0]?.game?.gamePk || appearances[0]?.game?.id || appearances[0]?.gamePk
            );
            const previousFeed = await gameFeed(previousGamePk);
            const previousMatchup = previousFeed?.liveData?.plays?.allPlays?.find((candidate) =>
                number(candidate?.matchup?.pitcher?.id) === pitcherId);
            const sameEntryBatter = number(previousMatchup?.matchup?.batter?.id) === batterId;
            if (previousMatchup && sameEntryBatter) {
                const batter = playerName(currentPlay?.matchup?.batter, data);
                const previousType = text(previousMatchup?.result?.eventType).toLowerCase();
                const previousResult = previousType.includes("strikeout")
                    ? "三振を奪っています"
                    : previousType.includes("out") || previousType.includes("double_play")
                        ? "打ち取っています"
                        : ["home_run", "single", "double", "triple"].includes(previousType)
                            ? "ヒットを許しています"
                            : "対戦しています";
                if (previousType.includes("strikeout")) {
                    relieverRematches.add(`${pitcherId}:${batterId}`);
                }
                const thirdStraight = text(appearances[1]?.date) === dateBefore(2);
                return `昨日も${batter}のところで登板。${previousResult}。` +
                    `今日で${thirdStraight ? "3" : "2"}連投です`;
            }
            const yesterday = appearances[0]?.stat ?? {};
            const strikeouts = number(yesterday?.strikeOuts);
            const runs = number(yesterday?.runs);
            const yesterdayOuts = inningsToOuts(yesterday?.inningsPitched);
            const yesterdayInnings = yesterdayOuts > 0 && yesterdayOuts % 3 === 0
                ? `${yesterdayOuts / 3}イニング`
                : inningsLabel(yesterday?.inningsPitched);
            const performance = strikeouts > 0
                ? `昨日は${yesterdayInnings}投げて、` +
                    `${strikeouts}つの三振を奪っています${runs ? `。${runs}失点でした` : ""}`
                : `昨日は${yesterdayInnings}を投げ、` +
                    `${runs ? `${runs}失点` : "無失点"}でした`;
            const thirdStraight = text(appearances[1]?.date) === dateBefore(2);
            return `${performance}。今日で${thirdStraight ? "3" : "2"}連投です`;
        }
        const previous = appearances[0]?.stat ?? {};
        const runs = number(previous?.runs);
        return `前回登板は${inningsLabel(previous?.inningsPitched)}${runs
            ? `${runs}失点`
            : "無失点"}`;
    };

    const prepareStarterNotes = async (data) => {
        starterNotes.clear();
        relieverNotes.clear();
        relieverRematches.clear();
        if (mode !== "full") return;
        await Promise.all(["away", "home"].map(async (side) => {
            const starter = starterForSide(side, data);
            if (!starter?.id) return;
            const opponentId = number(data?.gameData?.gameData?.teams?.[opponentSide(side)]?.id);
            const logs = await starterGameLogs(starter, data);
            const note = starterTrendNote(logs, opponentId);
            if (note) starterNotes.set(number(starter.id), note);
        }));
        const selectedRelieverIds = new Set();
        selection.forEach((item) => {
            if (item.type === "pitching-change" && item.incomingPitcherId) {
                selectedRelieverIds.add(number(item.incomingPitcherId));
                return;
            }
            const play = findPlay(item.atBatIndex, data);
            const pitcherId = number(play?.matchup?.pitcher?.id);
            if (pitcherId && pitcherAppearanceNumber(play, data) > 1) {
                selectedRelieverIds.add(pitcherId);
            }
        });
        const gameDate = text(data?.gameData?.gameData?.datetime?.officialDate);
        await Promise.all([...selectedRelieverIds].map(async (pitcherId) => {
            const logs = await starterGameLogs({ id: pitcherId }, data);
            const currentPlay = allPlays(data).find((play) =>
                number(play?.matchup?.pitcher?.id) === pitcherId);
            const note = await relieverTrendNote(logs, gameDate, currentPlay, data);
            if (note) relieverNotes.set(pitcherId, note);
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
        const japaneseMatchup = allPlays(data).find((play) =>
            isJapanesePlayer(play?.matchup?.pitcher, data) &&
            isJapanesePlayer(play?.matchup?.batter, data) &&
            number(starterForSide(opponentSide(battingSide(play)), data)?.id) ===
                number(play?.matchup?.pitcher?.id));
        if (japaneseMatchup) {
            lines.push(
                `Ｑ　${playerName(japaneseMatchup?.matchup?.pitcher, data)}と` +
                `${playerName(japaneseMatchup?.matchup?.batter, data)}の日本人対決に注目です`
            );
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

    const unshownReliefOutcomeLine = (play, data = snapshot()) => {
        const pitcherId = number(play?.matchup?.pitcher?.id);
        if (!pitcherId) return "";
        const inning = number(play?.about?.inning);
        const side = battingSide(play);
        const position = playPosition(play, data);
        const halfInning = allPlays(data).filter((candidate) =>
            number(candidate?.about?.inning) === inning && battingSide(candidate) === side);
        const remainder = allPlays(data).slice(position).filter((candidate) =>
            number(candidate?.about?.inning) === inning && battingSide(candidate) === side);
        const stint = remainder.filter((candidate) =>
            number(candidate?.matchup?.pitcher?.id) === pitcherId);
        if (!stint.length) return "";
        const before = scoreForSide(scoreBefore(play, data), side);
        const after = scoreForSide(scoreAfter(stint.at(-1)), side);
        const runsAllowedDuringStint = Math.max(0, after - before);
        const appearance = pitcherAppearanceNumber(play, data);
        const pitcher = playerName(play?.matchup?.pitcher, data);
        const subject = `${appearance > 1 ? `${circled(appearance)}人目` : ""}${pitcher}`;
        const finishedInning = number(stint.at(-1)?.count?.outs) >= 3;
        if (finishedInning) {
            if (!runsAllowedDuringStint) {
                return `　　このあと${subject}が無失点に切り抜けます`;
            }
            const inningBefore = scoreForSide(scoreBefore(halfInning[0], data), side);
            const inningAfter = scoreForSide(scoreAfter(stint.at(-1)), side);
            const inningRuns = Math.max(0, inningAfter - inningBefore);
            return `　　このあと${subject}も打ち込まれ、この回${circled(inningRuns)}点を失います`;
        }
        if (!runsAllowedDuringStint) {
            return `　　このあと${subject}は無失点でマウンドを降ります`;
        }
        return `　　このあと${subject}は${circled(runsAllowedDuringStint)}点を失い、マウンドを降ります`;
    };

    const generateNarration = () => {
        const data = snapshot();
        arrangeSelection();
        const selected = selection
            .map((item) => {
                if (item.type === "pitching-change") {
                    const change = findPitcherChange(item.incomingPitcherId, data);
                    return { ...item, change, play: change?.play };
                }
                return { ...item, play: findPlay(item.atBatIndex, data) };
            })
            .filter((item) => item.play);
        const plays = selected.map((item) => item.play);
        const selectedAtBats = new Set(selected
            .filter((item) => item.type !== "pitching-change")
            .map((item) => getAtBatIndex(item.play)));
        const lines = automaticHead(plays, data);
        const introducedStarters = new Set();
        selected.forEach((item, index) => {
            if (index > 0) {
                const bridge = unshownHalfClosingLines(selected[index - 1].play, item.play, data);
                if (bridge.length) lines.push("", ...bridge);
            }
            if (lines.length) lines.push("");
            if (item.type === "pitching-change") {
                const incoming = playerName({ id: item.incomingPitcherId }, data);
                const fieldingSide = opponentSide(battingSide(item.play));
                const appearance = pitcherAppearanceNumber(item.play, data);
                lines.push(
                    `Ｑ　${shortTeam(fieldingSide, data)}、ここで` +
                    `${appearance > 1 ? `${circled(appearance)}人目にスイッチ` : "投手交代"}`
                );
                const firstBatterIsSelected = selectedAtBats.has(getAtBatIndex(item.play));
                const outcome = firstBatterIsSelected ? "" : unshownReliefOutcomeLine(item.play, data);
                const note = relieverNotes.get(number(item.incomingPitcherId));
                if (note) lines.push(`　　${note}`);
                if (outcome) {
                    lines.push(outcome);
                } else if (incoming) {
                    lines.push(`　　${incoming}がマウンドに上がります`);
                }
                return;
            }
            lines.push(...starterIntroductionForPlay(item.play, introducedStarters, data));
            lines.push(...batterResultLines(
                item.play,
                item.detailKeys,
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
            const cell = item.type === "pitching-change"
                ? document.querySelector(
                    `.bench-pitcher-entry[data-incoming-pitcher-id="${item.incomingPitcherId}"]`
                )
                : document.querySelector(
                    `.atbat-cell[data-at-bat-index="${item.atBatIndex}"]`
                );
            if (!cell) return;
            cell.classList.add("highlight-script-selected");
            if (item.detailKeys?.length) cell.classList.add("highlight-script-detailed");
            const badge = document.createElement("span");
            badge.className = "highlight-script-order";
            badge.textContent = String(index + 1);
            cell.append(badge);
        });
        toolbar?.querySelector("[data-count]")?.replaceChildren(
            document.createTextNode(`${selection.length}件選択中`)
        );
    };

    const selectCell = (cell) => {
        const atBatIndex = Number(cell?.dataset?.atBatIndex);
        if (!Number.isInteger(atBatIndex)) return;
        const index = selection.findIndex((item) => item.atBatIndex === atBatIndex);
        if (index < 0) {
            selection.push({
                atBatIndex,
                detailKeys: [],
                selectionOrder: selectionSequence++
            });
        } else {
            selection.splice(index, 1);
        }
        arrangeSelection();
        refreshMarks();
    };

    const selectPitcherChange = (entry) => {
        const incomingPitcherId = number(entry?.dataset?.incomingPitcherId);
        const outgoingPitcherId = number(entry?.dataset?.outgoingPitcherId);
        if (!incomingPitcherId) return;
        const index = selection.findIndex((item) =>
            item.type === "pitching-change" && item.incomingPitcherId === incomingPitcherId);
        if (index >= 0) {
            selection.splice(index, 1);
        } else {
            const change = findPitcherChange(incomingPitcherId);
            selection.push({
                type: "pitching-change",
                incomingPitcherId,
                outgoingPitcherId,
                timelineIndex: getAtBatIndex(change?.play) - 0.1,
                selectionOrder: selectionSequence++
            });
        }
        arrangeSelection();
        refreshMarks();
    };

    const showDetailChooser = (cell) => {
        const atBatIndex = Number(cell?.dataset?.atBatIndex);
        const play = findPlay(atBatIndex);
        if (!play) return;
        let item = selection.find((candidate) => candidate.atBatIndex === atBatIndex);
        if (!item) {
            item = { atBatIndex, detailKeys: [], selectionOrder: selectionSequence++ };
            selection.push(item);
            arrangeSelection();
            refreshMarks();
        }
        const options = detailOptions(play);
        const pitchOptions = options.filter((option) => option.kind === "pitch");
        const chosen = new Set(item.detailKeys ?? []);
        const backdrop = document.createElement("div");
        backdrop.className = "highlight-script-dialog-backdrop";
        backdrop.innerHTML = `<section class="highlight-script-dialog highlight-detail-dialog" role="dialog" aria-modal="true" aria-label="詳細選択"><header><h2>${xml(inningLabel(play))}　${xml(playerName(play?.matchup?.batter))}の詳細</h2><button type="button" data-close>閉じる</button></header><p class="highlight-script-dialog-note">原稿や公式PBP資料で詳しく見せる投球・出来事を選択してください。</p><div class="highlight-detail-options">${pitchOptions.length ? `<label class="highlight-detail-all"><input type="checkbox" data-all-pitches> 全球</label>` : ""}${options.map((option) => `<label><input type="checkbox" value="${xml(option.key)}" ${chosen.has(option.key) ? "checked" : ""}> <span>${xml(option.label)}</span></label>`).join("") || "<p>選択できる詳細はありません。</p>"}</div><footer><button type="button" data-clear>詳細を外す</button><button type="button" data-save class="primary">決定</button></footer></section>`;
        const allPitches = backdrop.querySelector("[data-all-pitches]");
        const pitchChecks = pitchOptions.map((option) =>
            backdrop.querySelector(`input[value="${CSS.escape(option.key)}"]`)).filter(Boolean);
        const syncAll = () => {
            if (!allPitches) return;
            allPitches.checked = pitchChecks.length > 0 && pitchChecks.every((input) => input.checked);
            allPitches.indeterminate = pitchChecks.some((input) => input.checked) && !allPitches.checked;
        };
        syncAll();
        allPitches?.addEventListener("change", () => {
            pitchChecks.forEach((input) => { input.checked = allPitches.checked; });
            syncAll();
        });
        pitchChecks.forEach((input) => input.addEventListener("change", syncAll));
        const close = () => backdrop.remove();
        backdrop.querySelector("[data-close]").addEventListener("click", close);
        backdrop.querySelector("[data-clear]").addEventListener("click", () => {
            item.detailKeys = [];
            refreshMarks();
            close();
        });
        backdrop.querySelector("[data-save]").addEventListener("click", () => {
            item.detailKeys = [...backdrop.querySelectorAll(".highlight-detail-options input[value]:checked")]
                .map((input) => input.value);
            refreshMarks();
            close();
        });
        document.body.append(backdrop);
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

    const captureOfficialPbp = async (button) => {
        const data = snapshot();
        arrangeSelection();
        const events = selection.map((item) => {
            if (item.type === "pitching-change") {
                return {
                    type: "pitching-change",
                    incomingPitcher: text(resolvedPerson({ id: item.incomingPitcherId }, data)?.fullName),
                    outgoingPitcher: text(resolvedPerson({ id: item.outgoingPitcherId }, data)?.fullName)
                };
            }
            return { type: "atbat", atBatIndex: item.atBatIndex };
        });
        const uniqueEvents = events.filter((event, index, list) => {
            const key = event.type === "atbat"
                ? `atbat:${event.atBatIndex}`
                : `change:${event.incomingPitcher}:${event.outgoingPitcher}`;
            return list.findIndex((candidate) => (candidate.type === "atbat"
                ? `atbat:${candidate.atBatIndex}`
                : `change:${candidate.incomingPitcher}:${candidate.outgoingPitcher}`) === key) === index;
        });
        if (!uniqueEvents.length) {
            context()?.setStatus?.("PBP資料に使う打席が見つかりませんでした。選択し直してください。", true);
            return;
        }
        const original = button?.textContent;
        if (button) {
            button.disabled = true;
            button.textContent = "公式Gamedayを撮影中…";
        }
        context()?.setStatus?.(`公式Gamedayを撮影しています（${uniqueEvents.length}件）。完了までこの画面を閉じないでください。`);
        const job = {
            gamePk: data?.gamePk,
            date: text(data?.gameData?.gameData?.datetime?.officialDate).replaceAll("-", ""),
            away: data?.away?.abbreviation,
            home: data?.home?.abbreviation,
            events: uniqueEvents
        };
        try {
            if (location.protocol === "file:") {
                const form = document.createElement("form");
                form.method = "POST";
                form.action = "http://127.0.0.1:8765/capture-download";
                form.target = "_blank";
                form.hidden = true;
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = "job";
                input.value = JSON.stringify(job);
                form.append(input);
                document.body.append(form);
                form.submit();
                form.remove();
                context()?.setStatus?.("公式Gamedayの撮影を別タブで開始しました。完成するとPDFがダウンロードされます。");
                return;
            }
            const response = await fetch("http://127.0.0.1:8765/capture", {
                method: "POST",
                // file:// からローカルサーバーへの送信でブラウザの事前確認を
                // 発生させない。サーバー側は本文をJSONとして読み取る。
                headers: { "content-type": "text/plain;charset=UTF-8" },
                body: JSON.stringify(job)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result?.error || "PBP資料を作成できませんでした。");
            const link = document.createElement("a");
            link.href = result.url;
            link.download = result.filename;
            link.click();
            context()?.setStatus?.(`${result.filename} を作成しました。`);
        } catch (error) {
            context()?.setStatus?.(
                `PBP撮影サーバーに接続できません。ページを再読み込みしてから、もう一度実行してください。${error?.message ? `（${error.message}）` : ""}`,
                true
            );
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = original;
            }
        }
    };

    const pbpPitchColor = (pitch) => {
        if (pitch?.details?.isInPlay) return "#7e57c2";
        return pitch?.details?.isStrike ? "#d92332" : "#159447";
    };

    const pbpPitchChart = (play) => {
        const pitches = pitchEvents(play);
        const chartWidth = 190;
        const chartHeight = 150;
        const mapX = (value) => 95 + Math.max(-2.5, Math.min(2.5, number(value))) * 34;
        const mapY = (value) => 142 - Math.max(0, Math.min(5.5, number(value))) * 25;
        const zoneTop = number(pitches.find((pitch) => pitch?.pitchData?.strikeZoneTop)
            ?.pitchData?.strikeZoneTop) || 3.5;
        const zoneBottom = number(pitches.find((pitch) => pitch?.pitchData?.strikeZoneBottom)
            ?.pitchData?.strikeZoneBottom) || 1.5;
        const left = mapX(-0.83);
        const right = mapX(0.83);
        const top = mapY(zoneTop);
        const bottom = mapY(zoneBottom);
        const verticals = [1, 2].map((part) => {
            const x = left + ((right - left) * part / 3);
            return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`;
        }).join("");
        const horizontals = [1, 2].map((part) => {
            const y = top + ((bottom - top) * part / 3);
            return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`;
        }).join("");
        const points = pitches.map((pitch, index) => {
            const coordinates = pitch?.pitchData?.coordinates ?? {};
            if (!Number.isFinite(Number(coordinates.pX)) ||
                !Number.isFinite(Number(coordinates.pZ))) return "";
            const x = mapX(coordinates.pX);
            const y = mapY(coordinates.pZ);
            return `<g><circle cx="${x}" cy="${y}" r="8" fill="${pbpPitchColor(pitch)}"/>` +
                `<text x="${x}" y="${y + 3}" text-anchor="middle">${index + 1}</text></g>`;
        }).join("");
        return `<svg class="pitch-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" aria-label="投球位置">` +
            `<rect width="${chartWidth}" height="${chartHeight}" fill="#f3f1ea"/>` +
            `<path d="M15 145 Q95 100 175 145" fill="#d8c19b" stroke="#987b54"/>` +
            `<g class="zone"><rect x="${left}" y="${top}" width="${right - left}" ` +
            `height="${bottom - top}"/>${verticals}${horizontals}</g>${points}</svg>`;
    };

    const pbpPitchRows = (play) => pitchEvents(play).map((pitch, index) => {
        const speed = number(pitch?.pitchData?.startSpeed);
        const description = text(pitch?.details?.description || "Pitch");
        const type = text(pitch?.details?.type?.description);
        const count = pitch?.count ?? {};
        return `<li><b style="background:${pbpPitchColor(pitch)}">${index + 1}</b>` +
            `<span><strong>${xml(description)}</strong><small>` +
            `${speed ? `${speed.toFixed(1)} mph` : ""}${speed && type ? " " : ""}${xml(type)}` +
            `</small></span><em>${number(count.balls)} - ${number(count.strikes)}</em></li>`;
    }).join("");

    const pbpCard = (play, data) => {
        const score = scoreBefore(play, data);
        const away = text(data?.away?.abbreviation || "AWAY");
        const home = text(data?.home?.abbreviation || "HOME");
        const half = play?.about?.isTopInning === true ? "TOP" : "BOT";
        const pitcher = resolvedPerson(play?.matchup?.pitcher, data);
        const batter = resolvedPerson(play?.matchup?.batter, data);
        const pitches = pitchEvents(play);
        const result = text(play?.result?.event || "Play");
        const description = text(play?.result?.description);
        const compact = pitches.length >= 9 ? " compact" : "";
        const headshot = (person) => person?.id
            ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/${person.id}/headshot/67/current`
            : "";
        return `<article class="pbp-card${compact}">` +
            `<div class="game-line">${half} ${number(play?.about?.inning)}　|　` +
            `${xml(away)} ${score.away}, ${xml(home)} ${score.home}</div>` +
            `<h2>${xml(result)}</h2><p class="description">${xml(description)}</p>` +
            `<div class="matchup"><div>${headshot(pitcher) ? `<img src="${headshot(pitcher)}">` : ""}` +
            `<strong>${xml(pitcher?.lastName || pitcher?.fullName)}</strong><small>Pitcher</small></div>` +
            `<span class="count">${number(play?.count?.balls)} - ${number(play?.count?.strikes)}<small>○○○</small></span>` +
            `<div>${headshot(batter) ? `<img src="${headshot(batter)}">` : ""}` +
            `<strong>${xml(batter?.lastName || batter?.fullName)}</strong><small>Batter</small></div></div>` +
            `<h3>Pitch by Pitch</h3><div class="pitch-area">${pbpPitchChart(play)}` +
            `<ol>${pbpPitchRows(play)}</ol></div></article>`;
    };

    const printPbpMaterial = () => {
        const data = snapshot();
        arrangeSelection();
        const plays = selection.map((item) => findPlay(item.atBatIndex, data)).filter(Boolean);
        if (!plays.length) return;
        const officialDate = text(data?.gameData?.gameData?.datetime?.officialDate).replaceAll("-", "");
        const away = text(data?.away?.abbreviation || "AWAY");
        const home = text(data?.home?.abbreviation || "HOME");
        const printTitle = `${officialDate || "highlight"}_${away}@${home}_PBP資料`;
        const pages = [];
        for (let index = 0; index < plays.length; index += 4) {
            pages.push(`<section class="sheet">${plays.slice(index, index + 4)
                .map((play) => pbpCard(play, data)).join("")}</section>`);
        }
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
            context()?.setStatus?.("PBP資料を開けませんでした。ポップアップを許可してください。", true);
            return;
        }
        printWindow.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
            `<title>${xml(printTitle)}</title><style>
@page{size:A4 portrait;margin:9mm}*{box-sizing:border-box}body{margin:0;background:#ddd;color:#111;font-family:Arial,"Noto Sans JP",sans-serif}.sheet{width:192mm;height:279mm;margin:8mm auto;background:#fff;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:7mm;padding:5mm;page-break-after:always}.sheet:last-child{page-break-after:auto}.pbp-card{min-width:0;overflow:hidden;border:1.5px solid #bbb;border-radius:5px;padding:4mm;background:#fff}.game-line{font-size:8pt}.pbp-card h2{margin:2mm 0 1mm;font-size:16pt}.description{height:10mm;margin:0 0 2mm;font-size:8.5pt;line-height:1.35}.matchup{display:grid;grid-template-columns:1fr 20mm 1fr;align-items:center;padding:2mm 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd}.matchup>div{display:grid;grid-template-columns:12mm 1fr;grid-template-rows:1fr 1fr;align-items:center;gap:0 2mm;font-size:8pt}.matchup>div:last-child{text-align:right;grid-template-columns:1fr 12mm}.matchup>div:last-child img{grid-column:2;grid-row:1/3}.matchup img{width:11mm;height:11mm;object-fit:cover;border-radius:50%;grid-row:1/3}.matchup small{font-size:6.5pt;color:#666}.count{text-align:center;font-weight:700;font-size:10pt}.count small{display:block;letter-spacing:1px}.pbp-card h3{margin:2mm 0;font-size:10pt}.pitch-area{display:grid;grid-template-columns:45% 55%;gap:2mm}.pitch-chart{width:100%;height:47mm}.zone rect,.zone line{fill:none;stroke:#222;stroke-width:1}.pitch-chart text{fill:#fff;font-size:7px;font-weight:700}.pitch-area ol{list-style:none;margin:0;padding:0}.pitch-area li{display:grid;grid-template-columns:6mm 1fr 12mm;align-items:start;gap:1.5mm;margin-bottom:1.3mm;font-size:7pt}.pitch-area li>b{width:5mm;height:5mm;display:grid;place-items:center;border-radius:50%;color:#fff}.pitch-area li strong,.pitch-area li small{display:block;line-height:1.15}.pitch-area li small{font-size:6.4pt}.pitch-area li em{text-align:right;font-style:normal;font-weight:700}.compact .pitch-area li{margin-bottom:.6mm;font-size:6.3pt}.compact .pitch-area li small{font-size:5.8pt}@media print{body{background:#fff}.sheet{margin:0;padding:0;width:auto;height:279mm;gap:7mm}}
</style></head><body>${pages.join("")}<script>addEventListener("load",()=>setTimeout(()=>print(),500));<\/script></body></html>`);
        printWindow.document.close();
        context()?.setStatus?.(`選択した${plays.length}打席のPBP資料を作成しました。`);
    };

    const showPreview = (narration) => {
        dialog?.remove();
        const backdrop = document.createElement("div");
        backdrop.className = "highlight-script-dialog-backdrop";
        backdrop.innerHTML = `<section class="highlight-script-dialog" role="dialog" aria-modal="true" aria-label="ハイライト原稿プレビュー"><header><h2>ハイライト原稿</h2><button type="button" data-close aria-label="閉じる">閉じる</button></header><p class="highlight-script-dialog-note">実況・解説や映像指示は入れていません。必要に応じて本文を直してからWordへ出力できます。</p><textarea spellcheck="false"></textarea><footer><button type="button" data-reselect>選び直す</button><button type="button" data-official-pbp>公式PBP資料を作成</button><button type="button" data-download class="primary">Wordを出力</button></footer></section>`;
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
        backdrop.querySelector("[data-official-pbp]").addEventListener("click", (event) =>
            captureOfficialPbp(event.currentTarget));
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
        const pitcherChange = event.target.closest?.(
            ".bench-pitcher-entry[data-pitcher-change='true']"
        );
        if (pitcherChange) {
            event.preventDefault();
            event.stopImmediatePropagation();
            selectPitcherChange(pitcherChange);
            return;
        }
        const cell = event.target.closest?.(".atbat-cell[data-at-bat-index]");
        if (!cell) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.detail > 1) return;
        selectCell(cell);
    }, true);

    document.addEventListener("dblclick", (event) => {
        if (!active) return;
        const cell = event.target.closest?.(".atbat-cell[data-at-bat-index]");
        if (!cell) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        showDetailChooser(cell);
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
                detailKeys: Array.isArray(item.detailKeys)
                    ? [...item.detailKeys]
                    : item.detailed
                        ? detailOptions(findPlay(Number(item.atBatIndex)))
                            .filter((option) => option.kind === "pitch")
                            .map((option) => option.key)
                        : [],
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
