#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAME_BASE = path.join(ROOT, "data", "game-base", "years");
const RECORDS = path.join(ROOT, "data", "records", "backfill");
const EVIDENCE = path.join(ROOT, "data", "records", "pbp-evidence");
const REPORT = path.join(ROOT, "data", "records", "phase2-12-report.json");
const PROGRESS = path.join(EVIDENCE, "progress.json");
const PLAYER_NAMES = path.join(ROOT, "data", "game-base", "cache", "player-names.json");
const YEARS = Array.from({ length: 58 }, (_, index) => 1964 + index);
const CONCURRENCY = 5;
const CHECKPOINT_EVERY = 25;
const EVIDENCE_VERSION = "phase2-12-pbp-evidence-v2";
const RULE_VERSION = "daily-records-phase2-12-v1";
const API = "https://statsapi.mlb.com/api/v1/game";

const ALIASES = Object.freeze({
  PINCH_HIT_HOME_RUN: ["代打", "代打本塁打", "代打ホームラン", "ピンチヒッター", "pinch hit", "pinch-hit", "PH"],
  PINCH_HIT_GRAND_SLAM: ["代打", "代打本塁打", "代打満塁本塁打", "代打満塁ホームラン", "pinch hit", "pinch-hit", "PH"],
  PINCH_HIT_WALKOFF_HOME_RUN: ["代打", "代打本塁打", "代打サヨナラ本塁打", "サヨナラ", "サヨナラ本塁打", "pinch-hit", "walk-off", "PH"],
  PINCH_HIT_WALKOFF_GRAND_SLAM: ["代打", "代打本塁打", "代打満塁本塁打", "代打サヨナラ本塁打", "代打サヨナラ満塁本塁打", "サヨナラ", "サヨナラ満塁本塁打", "pinch-hit", "walk-off", "PH"],
  WALKOFF_HOME_RUN: ["サヨナラ", "サヨナラ本塁打", "サヨナラホームラン", "walk-off", "walkoff"],
  WALKOFF_HIT: ["サヨナラ", "サヨナラ安打", "walk-off", "walkoff"],
  WALKOFF_FORCED_RUN: ["サヨナラ", "サヨナラ四球", "サヨナラ死球", "サヨナラ押し出し", "押し出し四球", "押し出し死球", "walk-off"],
  WALKOFF_WILD_PITCH: ["サヨナラ", "サヨナラ暴投", "walk-off wild pitch"],
  WALKOFF_PASSED_BALL: ["サヨナラ", "サヨナラ捕逸", "walk-off passed ball"],
  WALKOFF_ERROR: ["サヨナラ", "サヨナラ失策", "walk-off error"],
  WALKOFF_BALK: ["サヨナラ", "サヨナラボーク", "walk-off balk"],
  WALKOFF_DROPPED_THIRD_STRIKE: ["サヨナラ", "サヨナラ振り逃げ", "振り逃げ", "walk-off strikeout"],
  WALKOFF_SPECIAL_PLAY: ["サヨナラ", "サヨナラ特殊プレー", "walk-off"],
  PERFECT_GAME: ["完全試合", "パーフェクトゲーム", "perfect game", "perfect-game", "ノーヒットノーラン", "ノーヒッター"]
});

const TEAM = Object.freeze({108:["LAA","Los Angeles Angels"],109:["ARI","Arizona Diamondbacks"],110:["BAL","Baltimore Orioles"],111:["BOS","Boston Red Sox"],112:["CHC","Chicago Cubs"],113:["CIN","Cincinnati Reds"],114:["CLE","Cleveland Guardians"],115:["COL","Colorado Rockies"],116:["DET","Detroit Tigers"],117:["HOU","Houston Astros"],118:["KC","Kansas City Royals"],119:["LAD","Los Angeles Dodgers"],120:["WSH","Washington Nationals"],121:["NYM","New York Mets"],133:["ATH","Athletics"],134:["PIT","Pittsburgh Pirates"],135:["SD","San Diego Padres"],136:["SEA","Seattle Mariners"],137:["SF","San Francisco Giants"],138:["STL","St. Louis Cardinals"],139:["TB","Tampa Bay Rays"],140:["TEX","Texas Rangers"],141:["TOR","Toronto Blue Jays"],142:["MIN","Minnesota Twins"],143:["PHI","Philadelphia Phillies"],144:["ATL","Atlanta Braves"],145:["CWS","Chicago White Sox"],146:["MIA","Miami Marlins"],147:["NYY","New York Yankees"],158:["MIL","Milwaukee Brewers"]});
const SLUG = Object.freeze({108:"angels",109:"d-backs",110:"orioles",111:"red-sox",112:"cubs",113:"reds",114:"guardians",115:"rockies",116:"tigers",117:"astros",118:"royals",119:"dodgers",120:"nationals",121:"mets",133:"athletics",134:"pirates",135:"padres",136:"mariners",137:"giants",138:"cardinals",139:"rays",140:"rangers",141:"blue-jays",142:"twins",143:"phillies",144:"braves",145:"white-sox",146:"marlins",147:"yankees",158:"brewers"});

const read = async (file, fallback = null) => JSON.parse(await fs.readFile(file, "utf8").catch((error) => {
  if (fallback !== null && error?.code === "ENOENT") return JSON.stringify(fallback);
  throw error;
}));
const atomicWrite = async (file, value, compact = false) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  const body = `${JSON.stringify(value, null, compact ? 0 : 2)}\n`;
  JSON.parse(body);
  await fs.writeFile(temporary, body);
  await fs.rename(temporary, file);
};
const PLAY_KEYS = ["atBatIndex","inning","halfInning","batterId","batterName","pitcherId",
  "eventType","event","rbi","isOut","awayScore","homeScore","outsBefore","outsAfter",
  "scoringRunnerIds","runners","actions","basesLoadedBefore","pinchHit","pinchHitSource","isScoringPlay"];
const RUNNER_KEYS = ["runnerId","start","end","outBase","isOut","eventType","rbi","earned"];
const ACTION_KEYS = ["eventType","event","description","playerId","position"];
const encodeRows = (values, keys) => (values ?? []).map((value) => keys.map((key) => value?.[key] ?? null));
const decodeRows = (values, keys) => (values ?? []).map((row) => Object.fromEntries(keys.map((key, index) => [key, row?.[index] ?? null])));
const encodeEvidenceYear = (year, games) => ({
  evidenceVersion: EVIDENCE_VERSION, year, playColumns: PLAY_KEYS,
  runnerColumns: RUNNER_KEYS, actionColumns: ACTION_KEYS,
  games: games.map((game) => [game.gamePk, game.officialDate, game.candidateKinds,
    game.plays.map((play) => PLAY_KEYS.map((key) => key === "runners"
      ? encodeRows(play.runners, RUNNER_KEYS) : key === "actions"
        ? encodeRows(play.actions, ACTION_KEYS) : play[key] ?? null))])
});
const decodeEvidenceYear = (year, value) => {
  if (!Array.isArray(value?.games?.[0])) return { year, games: value?.games ?? [], legacy: true };
  const playKeys = value.playColumns ?? PLAY_KEYS;
  const runnerKeys = value.runnerColumns ?? RUNNER_KEYS;
  const actionKeys = value.actionColumns ?? ACTION_KEYS;
  return { year, games: value.games.map((game) => ({ gamePk: game[0], officialDate: game[1],
    candidateKinds: game[2] ?? [], plays: (game[3] ?? []).map((row) => {
      const play = Object.fromEntries(playKeys.map((key, index) => [key, row[index] ?? null]));
      play.runners = decodeRows(play.runners, runnerKeys); play.actions = decodeRows(play.actions, actionKeys);
      return play;
    }) })), legacy: value.evidenceVersion !== EVIDENCE_VERSION };
};
const unpack = (columns, row) => Object.fromEntries(columns.map((key, index) => [key, row[index] ?? null]));
const normalizeTeam = (teamRow, columns) => {
  const team = unpack(columns.team, teamRow);
  team.batters = (team.batters ?? []).map((row) => unpack(columns.batter, row));
  team.pitchers = (team.pitchers ?? []).map((row) => unpack(columns.pitcher, row));
  return team;
};
const normalizeGame = (row, columns) => {
  const game = unpack(columns.game, row);
  game.away = normalizeTeam(game.away, columns);
  game.home = normalizeTeam(game.home, columns);
  return game;
};
const recordKey = (record) => [record.recordType, record.gamePk,
  record.playerId || `team-${record.teamId}`, record.inning || 0,
  record.details?.metric || ""].join(":");
const candidateKinds = (game) => {
  const kinds = [];
  if ([...game.away.batters, ...game.home.batters].some((batter) =>
    Number(batter.HR) >= 1 && (batter.gamePositions ?? []).includes("PH"))) kinds.push("pinchHit");
  if (game.walkoffCandidate === true || game.walkoff === true) kinds.push("walkoff");
  if (game.perfectGameCandidate === true) kinds.push("perfectGame");
  return kinds;
};
const baseName = (value) => String(value ?? "").trim();
const normalizePlay = (play) => {
  const actions = (play?.playEvents ?? []).filter((event) => event?.type === "action").map((event) => ({
    eventType: baseName(event?.details?.eventType).toLowerCase(),
    event: baseName(event?.details?.event), description: baseName(event?.details?.description),
    playerId: Number(event?.player?.id) || null,
    position: baseName(event?.position?.abbreviation || event?.position?.name)
  }));
  const runners = (play?.runners ?? []).map((runner) => ({
    runnerId: Number(runner?.details?.runner?.id) || null,
    start: baseName(runner?.movement?.start), end: baseName(runner?.movement?.end),
    outBase: baseName(runner?.movement?.outBase), isOut: runner?.movement?.isOut === true,
    eventType: baseName(runner?.details?.eventType).toLowerCase(),
    rbi: runner?.details?.rbi === true, earned: runner?.details?.earned === true
  }));
  const scoringRunnerIds = runners.filter((runner) => runner.end === "score" && !runner.isOut)
    .map((runner) => runner.runnerId).filter(Boolean);
  const occupied = new Set(runners.map((runner) => runner.start).filter((base) => ["1B","2B","3B"].includes(base)));
  const batterId = Number(play?.matchup?.batter?.id) || null;
  const pinchAction = actions.find((action) => action.playerId === batterId &&
    ["offensive_substitution", "pinch_hitter"].includes(action.eventType) &&
    /pinch[- ]?hitter|代打/i.test(`${action.event} ${action.description}`));
  return {
    atBatIndex: Number(play?.about?.atBatIndex), inning: Number(play?.about?.inning),
    halfInning: baseName(play?.about?.halfInning).toLowerCase(),
    batterId, batterName: baseName(play?.matchup?.batter?.fullName),
    pitcherId: Number(play?.matchup?.pitcher?.id) || null,
    eventType: baseName(play?.result?.eventType).toLowerCase(), event: baseName(play?.result?.event),
    rbi: Number(play?.result?.rbi) || 0, isOut: play?.result?.isOut === true,
    description: baseName(play?.result?.description), awayScore: Number(play?.result?.awayScore),
    homeScore: Number(play?.result?.homeScore), outsBefore: null,
    outsAfter: Number.isFinite(Number(play?.count?.outs)) ? Number(play.count.outs) : null,
    scoringRunnerIds, runners, actions, basesLoadedBefore: occupied.size === 3,
    pinchHit: Boolean(pinchAction), pinchHitSource: pinchAction ? "offensive_substitution" : "",
    isScoringPlay: play?.about?.isScoringPlay === true
  };
};
const normalizeEvidence = (candidate, payload) => ({
  evidenceVersion: EVIDENCE_VERSION, gamePk: candidate.gamePk,
  officialDate: candidate.officialDate, candidateKinds: candidate.kinds,
  plays: (payload?.allPlays ?? []).filter((play) => play?.about?.isComplete !== false).map(normalizePlay)
});

const fetchPbp = async (candidate) => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${API}/${candidate.gamePk}/playByPlay`, {
        headers: { "user-agent": "mlb-scorebook-generator-phase2-12/1" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeEvidence(candidate, await response.json());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
};

const isWalkoff = (game, play) => play && play.halfInning === "bottom" &&
  play.scoringRunnerIds.length > 0 && play.homeScore > play.awayScore;
const grandSlam = (play) => play.eventType === "home_run" &&
  (play.basesLoadedBefore || play.rbi >= 4);
const playerNameMaps = async () => {
  const master = await read(PLAYER_NAMES, { players: {} });
  const players = new Map(Object.entries(master.players ?? {}).map(([id, value]) => [Number(id),
    baseName(value?.displayName || value?.fullName || value?.name)]));
  const japanese = new Set(); const games = new Map(); const teams = new Map();
  for (const year of YEARS) for (const record of await read(path.join(RECORDS, `${year}.json`), [])) {
    if (record.playerId && record.playerName) players.set(Number(record.playerId), record.playerName);
    if (record.playerId && record.isJapanesePlayer) japanese.add(Number(record.playerId));
    if (record.gamePk) games.set(Number(record.gamePk), record);
    if (record.teamId) teams.set(Number(record.teamId), [record.teamCode, record.teamName]);
    if (record.opponentId) teams.set(Number(record.opponentId), [record.opponentCode, record.opponentName]);
  }
  return { players, japanese, games, teams };
};
const makeRecordFactory = (maps) => (game, recordType, side, play, fact, details = {}) => {
  const team = game[side], opponent = game[side === "away" ? "home" : "away"];
  const playerId = Number(play?.batterId || game[side].pitchers?.[0]?.playerId) || null;
  const teamInfo = maps.teams.get(Number(team.teamId)) || TEAM[team.teamId] || [String(team.teamId), ""];
  const opponentInfo = maps.teams.get(Number(opponent.teamId)) || TEAM[opponent.teamId] || [String(opponent.teamId), ""];
  const awaySlug = SLUG[game.away.teamId], homeSlug = SLUG[game.home.teamId];
  const gamedayUrl = awaySlug && homeSlug
    ? `https://www.mlb.com/gameday/${awaySlug}-vs-${homeSlug}/${String(game.officialDate).replaceAll("-", "/")}/${game.gamePk}/final`
    : "";
  const record = { recordType, aliases: ALIASES[recordType] ?? [],
    category: playerId && maps.japanese.has(playerId) ? "japanese" : "individual",
    date: game.officialDate, season: Number(String(game.officialDate).slice(0,4)),
    gameType: game.gameType || "R", gamePk: Number(game.gamePk), playerId,
    playerName: playerId ? (maps.players.get(playerId) || play?.batterName || `選手ID ${playerId}`) : "",
    teamId: Number(team.teamId), teamCode: teamInfo[0], teamName: teamInfo[1],
    opponentId: Number(opponent.teamId), opponentCode: opponentInfo[0], opponentName: opponentInfo[1],
    inning: play?.inning || null, gameDate: game.officialDate,
    battingSide: playerId ? side : null,
    pitchingSide: recordType === "PERFECT_GAME" ? side : null,
    fact, description: fact, details, evidence: `MLB公式PBP正規化証跡 ${EVIDENCE_VERSION}`,
    apiStatus: "confirmed", apiConfirmed: true,
    historicalContext: { status: "needs-review", text: "", sources: [] },
    gamedayUrl: maps.games.get(Number(game.gamePk))?.gamedayUrl || gamedayUrl,
    articleUrls: [], feedUpdatedAt: "", ruleVersion: RULE_VERSION,
    isJapanesePlayer: playerId ? maps.japanese.has(playerId) : false };
  record.uniqueKey = record.archiveKey = recordKey(record);
  return record;
};

const detect = (game, evidence, makeRecord) => {
  const records = []; const plays = evidence.plays;
  const last = plays.at(-1); const walkoff = isWalkoff(game, last);
  const sideFor = (play) => play.halfInning === "top" ? "away" : "home";
  const push = (type, side, play, fact, details) => records.push(makeRecord(game, type, side, play, fact, details));
  for (const play of plays.filter((entry) => entry.eventType === "home_run" && entry.pinchHit)) {
    const side = sideFor(play), isLast = walkoff && play.atBatIndex === last.atBatIndex;
    const slam = grandSlam(play); let type = "PINCH_HIT_HOME_RUN", fact = "代打本塁打";
    if (isLast && slam) { type = "PINCH_HIT_WALKOFF_GRAND_SLAM"; fact = "代打サヨナラ満塁本塁打"; }
    else if (isLast) { type = "PINCH_HIT_WALKOFF_HOME_RUN"; fact = "代打サヨナラ本塁打"; }
    else if (slam) { type = "PINCH_HIT_GRAND_SLAM"; fact = "代打満塁本塁打"; }
    push(type, side, play, fact, { pinchHit: true, grandSlam: slam, walkoff: isLast });
  }
  if (walkoff) {
    const side = "home", prefix = `${last.inning}回裏 `;
    if (last.eventType === "home_run") {
      if (!grandSlam(last) && !last.pinchHit) push("WALKOFF_HOME_RUN", side, last,
        `${prefix}サヨナラ本塁打`, { walkoff: true });
    } else if (["single","double","triple"].includes(last.eventType)) {
      push("WALKOFF_HIT", side, last, `${prefix}サヨナラ安打`, { hitType: last.eventType });
    } else if (["walk","intent_walk","intentional_walk","hit_by_pitch"].includes(last.eventType) && last.basesLoadedBefore) {
      const hbp = last.eventType === "hit_by_pitch";
      push("WALKOFF_FORCED_RUN", side, last, `${prefix}サヨナラ押し出し${hbp ? "死球" : "四球"}`,
        { resultType: hbp ? "hitByPitch" : "walk", basesLoaded: true });
    } else if (last.eventType === "wild_pitch") push("WALKOFF_WILD_PITCH", side, last, `${prefix}サヨナラ暴投`);
    else if (last.eventType === "passed_ball") push("WALKOFF_PASSED_BALL", side, last, `${prefix}サヨナラ捕逸`);
    else if (["field_error","error"].includes(last.eventType)) push("WALKOFF_ERROR", side, last, `${prefix}サヨナラ失策`);
    else if (last.eventType === "balk") push("WALKOFF_BALK", side, last, `${prefix}サヨナラボーク`);
    else if (["strikeout","strikeout_double_play"].includes(last.eventType) && !last.isOut) {
      push("WALKOFF_DROPPED_THIRD_STRIKE", side, last, `${prefix}サヨナラ振り逃げ`, { eventType: last.eventType });
    } else if (["fielders_choice","sac_fly","sac_bunt"].includes(last.eventType)) {
      const label = { fielders_choice: "野選", sac_fly: "犠牲フライ", sac_bunt: "犠牲バント" }[last.eventType];
      push("WALKOFF_SPECIAL_PLAY", side, last, `${prefix}サヨナラ${label}`,
        { eventType: last.eventType });
    }
  }
  if (game.perfectGameCandidate === true) {
    const winnerSide = game.awayScore > game.homeScore ? "away" : "home";
    const opponentHalf = winnerSide === "home" ? "top" : "bottom";
    const reached = plays.filter((play) => play.halfInning === opponentHalf).some((play) => {
      if (["single","double","triple","home_run","walk","intent_walk","intentional_walk",
        "hit_by_pitch","field_error","catcher_interf","catcher_interference"].includes(play.eventType)) return true;
      return play.runners.some((runner) => !runner.isOut && runner.end && runner.end !== "score" &&
        runner.runnerId === play.batterId);
    });
    const pitcher = game[winnerSide].pitchers?.[0];
    if (!reached && pitcher && game[winnerSide].pitchers.length === 1 &&
      pitcher.completedGameDerived === true && game.officialNoHitterEligible === true &&
      game.shortenedState === 0 && Number(pitcher.outs) >= Number(game.scheduledInnings) * 3) {
      const pitcherPlay = { batterId: pitcher.playerId, batterName: mapsForDetect.players.get(Number(pitcher.playerId)) || "" };
      push("PERFECT_GAME", winnerSide, pitcherPlay, "完全試合", { outs: pitcher.outs, battersFaced: pitcher.battersFaced });
    }
  }
  return records;
};

let mapsForDetect;
const main = async () => {
  await fs.mkdir(EVIDENCE, { recursive: true }); mapsForDetect = await playerNameMaps();
  const makeRecord = makeRecordFactory(mapsForDetect); const candidates = []; const gamesByPk = new Map();
  const candidateCounts = { pinchHit: 0, walkoff: 0, perfectGame: 0 };
  for (const year of YEARS) {
    const source = await read(path.join(GAME_BASE, `${year}.json`));
    for (const row of source.games) {
      const game = normalizeGame(row, source.columns); const kinds = candidateKinds(game);
      if (!kinds.length) continue; kinds.forEach((kind) => candidateCounts[kind] += 1);
      const candidate = { year, gamePk: Number(game.gamePk), officialDate: game.officialDate, kinds };
      candidates.push(candidate); gamesByPk.set(candidate.gamePk, game);
    }
  }
  const evidenceByYear = new Map(); const existingPks = new Set(); const dirtyYears = new Set();
  for (const year of YEARS) {
    const file = path.join(EVIDENCE, `${year}.json`);
    const decoded = decodeEvidenceYear(year, await read(file, { evidenceVersion: EVIDENCE_VERSION, year, games: [] }));
    evidenceByYear.set(year, decoded); decoded.games.forEach((game) => existingPks.add(Number(game.gamePk)));
    if (decoded.legacy) dirtyYears.add(year);
  }
  const progress = await read(PROGRESS, { evidenceVersion: EVIDENCE_VERSION, failures: [] });
  const failures = new Map((progress.failures ?? []).map((failure) => [Number(failure.gamePk), failure]));
  const pending = candidates.filter((candidate) => !existingPks.has(candidate.gamePk));
  let cursor = 0, fetched = 0, reused = candidates.length - pending.length, parsed = 0;
  let completedAttempts = 0; let checkpointQueue = Promise.resolve();
  const checkpoint = async () => {
    const years = [...dirtyYears];
    for (const year of years) {
      const value = evidenceByYear.get(year);
      value.games.sort((a,b) => a.gamePk-b.gamePk);
      await atomicWrite(path.join(EVIDENCE, `${year}.json`), encodeEvidenceYear(year, value.games), true);
      dirtyYears.delete(year);
    }
    await atomicWrite(PROGRESS, { evidenceVersion: EVIDENCE_VERSION, candidateCounts,
      uniqueCandidates: candidates.length, completed: existingPks.size, failures: [...failures.values()], updatedAt: new Date().toISOString() });
  };
  const worker = async () => {
    while (cursor < pending.length) {
      const candidate = pending[cursor++];
      try {
        const evidence = await fetchPbp(candidate); evidenceByYear.get(candidate.year).games.push(evidence);
        dirtyYears.add(candidate.year);
        existingPks.add(candidate.gamePk); failures.delete(candidate.gamePk); fetched += 1; parsed += 1;
      } catch (error) {
        failures.set(candidate.gamePk, { gamePk: candidate.gamePk, year: candidate.year, error: error?.message || String(error) });
      }
      completedAttempts += 1;
      if (completedAttempts % CHECKPOINT_EVERY === 0) {
        checkpointQueue = checkpointQueue.then(checkpoint);
        await checkpointQueue;
        console.log(`progress ${existingPks.size}/${candidates.length} fetched=${fetched} failures=${failures.size}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await checkpointQueue;
  await checkpoint();
  const addedCounts = {}, oldest = {}, newest = {}; const phase212Keys = new Set();
  const unresolvedPlayerIds = new Set(); let added = 0, finalRecords = 0;
  for (const year of YEARS) {
    const prior = await read(path.join(RECORDS, `${year}.json`), []);
    const generated = evidenceByYear.get(year).games.flatMap((evidence) =>
      detect(gamesByPk.get(Number(evidence.gamePk)), evidence, makeRecord));
    const preserved = prior.filter((record) => record.ruleVersion !== RULE_VERSION);
    const merged = new Map();
    for (const record of generated) {
      const key = recordKey(record); phase212Keys.add(key);
      if (record.playerId && /^選手ID\s+\d+$/.test(record.playerName)) unresolvedPlayerIds.add(record.playerId);
      merged.set(key, record); addedCounts[record.recordType] = (addedCounts[record.recordType] || 0) + 1;
      const summary = { date: record.date, gamePk: record.gamePk, playerName: record.playerName };
      if (!oldest[record.recordType] || String(record.date) < String(oldest[record.recordType].date)) oldest[record.recordType] = summary;
      if (!newest[record.recordType] || String(record.date) > String(newest[record.recordType].date)) newest[record.recordType] = summary;
      added += 1;
    }
    const phaseRecords = [...merged.values()].sort((a,b) =>
      String(a.date).localeCompare(String(b.date)) || Number(a.gamePk)-Number(b.gamePk) || recordKey(a).localeCompare(recordKey(b)));
    finalRecords += preserved.length + phaseRecords.length;
    await atomicWrite(path.join(RECORDS, `${year}.json`), [...preserved, ...phaseRecords]);
  }
  await atomicWrite(path.join(EVIDENCE, "manifest.json"), { evidenceVersion: EVIDENCE_VERSION,
    years: YEARS, candidateCounts, uniqueCandidates: candidates.length, evidenceGames: existingPks.size,
    apiFetched: existingPks.size, apiFetchedThisRun: fetched, cacheReusedThisRun: reused,
    failures: [...failures.values()], updatedAt: new Date().toISOString() });
  await atomicWrite(REPORT, { schemaVersion: 1, ruleVersion: RULE_VERSION, candidateCounts,
    uniqueCandidateGamePks: candidates.length, duplicateCandidatesRemoved: Object.values(candidateCounts).reduce((a,b)=>a+b,0)-candidates.length,
    pbpFetched: existingPks.size, pbpFetchedThisRun: fetched, cacheReusedThisRun: reused,
    evidenceGames: existingPks.size, pbpParseErrors: fetched-parsed,
    apiFailures: [...failures.values()], detectedRecords: added, insertedRecords: phase212Keys.size,
    existingRecordsBeforePhase2_12: finalRecords - phase212Keys.size, finalRecords, byRecordType: addedCounts,
    insertedByRecordType: addedCounts, unresolvedPlayerIds: [...unresolvedPlayerIds].sort((a,b)=>a-b), oldest, newest,
    gameBaseSchemaVersion: 1, generatedAt: new Date().toISOString() });
  console.log(JSON.stringify({ candidateCounts, uniqueCandidates: candidates.length, fetched, reused,
    failures: failures.size, detected: added, inserted: phase212Keys.size, unresolvedPlayers: unresolvedPlayerIds.size,
    byRecordType: addedCounts }, null, 2));
};

await main();
