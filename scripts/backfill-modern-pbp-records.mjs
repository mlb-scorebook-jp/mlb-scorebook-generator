#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORDS = path.join(ROOT, "data", "records");
const PLAYER_NAMES = path.join(ROOT, "data", "game-base", "cache", "player-names.json");
const PLAYER_READINGS = path.join(ROOT, "js", "players.js");
const REPORT = path.join(RECORDS, "modern-pbp-backfill-report.json");
const API = "https://statsapi.mlb.com/api/v1";
const RULE_VERSION = "daily-records-modern-pbp-v1";
const currentYear = new Date().getUTCFullYear();
const years = (process.argv.slice(2).length ? process.argv.slice(2).map(Number)
  : Array.from({ length: Math.max(0, currentYear - 2021) }, (_, index) => 2022 + index))
  .filter((year) => Number.isInteger(year) && year >= 2022 && year <= currentYear);

const TEAM = Object.freeze({108:["LAA","Los Angeles Angels"],109:["ARI","Arizona Diamondbacks"],110:["BAL","Baltimore Orioles"],111:["BOS","Boston Red Sox"],112:["CHC","Chicago Cubs"],113:["CIN","Cincinnati Reds"],114:["CLE","Cleveland Guardians"],115:["COL","Colorado Rockies"],116:["DET","Detroit Tigers"],117:["HOU","Houston Astros"],118:["KC","Kansas City Royals"],119:["LAD","Los Angeles Dodgers"],120:["WSH","Washington Nationals"],121:["NYM","New York Mets"],133:["ATH","Athletics"],134:["PIT","Pittsburgh Pirates"],135:["SD","San Diego Padres"],136:["SEA","Seattle Mariners"],137:["SF","San Francisco Giants"],138:["STL","St. Louis Cardinals"],139:["TB","Tampa Bay Rays"],140:["TEX","Texas Rangers"],141:["TOR","Toronto Blue Jays"],142:["MIN","Minnesota Twins"],143:["PHI","Philadelphia Phillies"],144:["ATL","Atlanta Braves"],145:["CWS","Chicago White Sox"],146:["MIA","Miami Marlins"],147:["NYY","New York Yankees"],158:["MIL","Milwaukee Brewers"]});
const SLUG = Object.freeze({108:"angels",109:"d-backs",110:"orioles",111:"red-sox",112:"cubs",113:"reds",114:"guardians",115:"rockies",116:"tigers",117:"astros",118:"royals",119:"dodgers",120:"nationals",121:"mets",133:"athletics",134:"pirates",135:"padres",136:"mariners",137:"giants",138:"cardinals",139:"rays",140:"rangers",141:"blue-jays",142:"twins",143:"phillies",144:"braves",145:"white-sox",146:"marlins",147:"yankees",158:"brewers"});
const ALIASES = Object.freeze({
  PINCH_HIT_HOME_RUN:["代打","代打本塁打","代打ホームラン","ピンチヒッター","pinch hit","pinch-hit","PH"],
  PINCH_HIT_GRAND_SLAM:["代打","代打本塁打","代打満塁本塁打","代打満塁ホームラン","pinch hit","pinch-hit","PH"],
  PINCH_HIT_WALKOFF_HOME_RUN:["代打","代打本塁打","代打サヨナラ本塁打","サヨナラ","サヨナラ本塁打","pinch-hit","walk-off","PH"],
  PINCH_HIT_WALKOFF_GRAND_SLAM:["代打","代打本塁打","代打満塁本塁打","代打サヨナラ本塁打","代打サヨナラ満塁本塁打","サヨナラ","walk-off","PH"],
  WALKOFF_HOME_RUN:["サヨナラ","サヨナラ本塁打","サヨナラホームラン","walk-off","walkoff"],
  WALKOFF_HIT:["サヨナラ","サヨナラ安打","walk-off","walkoff"],
  WALKOFF_FORCED_RUN:["サヨナラ","サヨナラ四球","サヨナラ死球","サヨナラ押し出し","walk-off"],
  WALKOFF_WILD_PITCH:["サヨナラ","サヨナラ暴投","walk-off wild pitch"],
  WALKOFF_PASSED_BALL:["サヨナラ","サヨナラ捕逸","walk-off passed ball"],
  WALKOFF_ERROR:["サヨナラ","サヨナラ失策","walk-off error"],
  WALKOFF_BALK:["サヨナラ","サヨナラボーク","walk-off balk"],
  WALKOFF_DROPPED_THIRD_STRIKE:["サヨナラ","サヨナラ振り逃げ","振り逃げ","walk-off strikeout"],
  WALKOFF_SPECIAL_PLAY:["サヨナラ","サヨナラ特殊プレー","walk-off"]
});

const read = async (file, fallback = null) => JSON.parse(await fs.readFile(file, "utf8").catch((error) => {
  if (fallback !== null && error?.code === "ENOENT") return JSON.stringify(fallback);
  throw error;
}));
const write = async (file, value) => {
  const temporary = `${file}.tmp-${process.pid}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(body);
  await fs.writeFile(temporary, body);
  await fs.rename(temporary, file);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchJson = async (url) => {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "mlb-scorebook-generator-modern-pbp/1" } });
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await wait(500 * (attempt + 1));
  }
  throw lastError;
};
const mapConcurrent = async (values, concurrency, task) => {
  const results = new Array(values.length); let cursor = 0;
  const worker = async () => { while (cursor < values.length) { const index = cursor++; results[index] = await task(values[index], index); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length || 1) }, worker));
  return results;
};
const recordKey = (record) => [record.recordType, record.gamePk,
  record.playerId || `team-${record.teamId}`, record.inning || 0, record.details?.metric || ""].join(":");
const playerNameKey = (value) => String(value ?? "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const scheduleForYear = async (year) => {
  const end = year === currentYear ? new Date().toISOString().slice(0, 10) : `${year}-11-30`;
  const params = new URLSearchParams({ sportId: "1", startDate: `${year}-03-01`, endDate: end,
    gameTypes: "R,F,D,L,W", hydrate: "linescore" });
  const payload = await fetchJson(`${API}/schedule?${params}`);
  return (payload.dates ?? []).flatMap((entry) => entry.games ?? []).filter((game) =>
    ["F", "O"].includes(String(game?.status?.codedGameState)));
};
const isWalkoffCandidate = (game) => {
  if (Number(game?.teams?.home?.score) <= Number(game?.teams?.away?.score)) return false;
  const innings = game?.linescore?.innings ?? [];
  const last = innings.at(-1);
  return Number(last?.home?.runs) > 0 && Number(last?.num) === Number(game?.linescore?.currentInning);
};
const homeRunPlayers = async (year) => {
  const params = new URLSearchParams({ stats: "season", group: "hitting", season: String(year),
    sportIds: "1", playerPool: "ALL", sortStat: "homeRuns", order: "desc", limit: "2000" });
  const payload = await fetchJson(`${API}/stats?${params}`);
  return (payload.stats?.[0]?.splits ?? []).filter((split) => Number(split?.stat?.homeRuns) > 0)
    .map((split) => Number(split?.player?.id)).filter(Boolean);
};
const pinchHomerGamePks = async (year) => {
  const players = await homeRunPlayers(year); let completed = 0;
  const values = await mapConcurrent(players, 5, async (playerId) => {
    const payload = await fetchJson(`${API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${year}`);
    completed += 1;
    if (completed % 50 === 0) console.log(`${year}: home-run game logs ${completed}/${players.length}`);
    return (payload.stats?.[0]?.splits ?? []).filter((split) => Number(split?.stat?.homeRuns) > 0 &&
      (split?.positionsPlayed ?? []).some((position) => position?.abbreviation === "PH"))
      .map((split) => Number(split?.game?.gamePk)).filter(Boolean);
  });
  return new Set(values.flat());
};
const normalizePlay = (play) => {
  const actions = (play?.playEvents ?? []).filter((event) => event?.type === "action");
  const batterId = Number(play?.matchup?.batter?.id) || null;
  const pinchHit = actions.some((event) => Number(event?.player?.id) === batterId &&
    /pinch[- ]?hitter|代打/i.test(`${event?.details?.event ?? ""} ${event?.details?.description ?? ""}`));
  const runners = play?.runners ?? [];
  const occupied = new Set(runners.map((runner) => runner?.movement?.start).filter((base) => ["1B","2B","3B"].includes(base)));
  return { inning:Number(play?.about?.inning), halfInning:String(play?.about?.halfInning ?? "").toLowerCase(),
    atBatIndex:Number(play?.about?.atBatIndex), batterId, batterName:String(play?.matchup?.batter?.fullName ?? ""),
    eventType:String(play?.result?.eventType ?? "").toLowerCase(), rbi:Number(play?.result?.rbi) || 0,
    awayScore:Number(play?.result?.awayScore), homeScore:Number(play?.result?.homeScore), pinchHit,
    basesLoadedBefore:occupied.size === 3,
    scoringRunnerIds:runners.filter((runner) => runner?.movement?.end === "score" && runner?.movement?.isOut !== true) };
};
const detect = (game, payload) => {
  const plays = (payload?.allPlays ?? []).filter((play) => play?.about?.isComplete !== false).map(normalizePlay);
  const last = plays.at(-1); if (!last) return [];
  const walkoff = last.halfInning === "bottom" && last.scoringRunnerIds.length > 0 && last.homeScore > last.awayScore;
  const records = [];
  const add = (recordType, play, fact, details = {}) => records.push({ recordType, play, fact, details });
  for (const play of plays.filter((entry) => entry.eventType === "home_run" && entry.pinchHit)) {
    const isLast = walkoff && play.atBatIndex === last.atBatIndex;
    const slam = play.basesLoadedBefore || play.rbi >= 4;
    if (isLast && slam) add("PINCH_HIT_WALKOFF_GRAND_SLAM", play, "代打サヨナラ満塁本塁打", { pinchHit:true, grandSlam:true, walkoff:true });
    else if (isLast) add("PINCH_HIT_WALKOFF_HOME_RUN", play, "代打サヨナラ本塁打", { pinchHit:true, grandSlam:false, walkoff:true });
    else if (slam) add("PINCH_HIT_GRAND_SLAM", play, "代打満塁本塁打", { pinchHit:true, grandSlam:true, walkoff:false });
    else add("PINCH_HIT_HOME_RUN", play, "代打本塁打", { pinchHit:true, grandSlam:false, walkoff:false });
  }
  if (walkoff) {
    const prefix = `${last.inning}回裏 `;
    if (last.eventType === "home_run" && !last.pinchHit) add("WALKOFF_HOME_RUN", last, `${prefix}サヨナラ本塁打`, { walkoff:true });
    else if (["single","double","triple"].includes(last.eventType)) add("WALKOFF_HIT", last, `${prefix}サヨナラ安打`, { hitType:last.eventType });
    else if (["walk","intent_walk","intentional_walk","hit_by_pitch"].includes(last.eventType) && last.basesLoadedBefore) add("WALKOFF_FORCED_RUN", last, `${prefix}サヨナラ押し出し${last.eventType === "hit_by_pitch" ? "死球" : "四球"}`);
    else if (last.eventType === "wild_pitch") add("WALKOFF_WILD_PITCH", last, `${prefix}サヨナラ暴投`);
    else if (last.eventType === "passed_ball") add("WALKOFF_PASSED_BALL", last, `${prefix}サヨナラ捕逸`);
    else if (["field_error","error"].includes(last.eventType)) add("WALKOFF_ERROR", last, `${prefix}サヨナラ失策`);
    else if (last.eventType === "balk") add("WALKOFF_BALK", last, `${prefix}サヨナラボーク`);
    else if (["strikeout","strikeout_double_play"].includes(last.eventType)) add("WALKOFF_DROPPED_THIRD_STRIKE", last, `${prefix}サヨナラ振り逃げ`);
    else if (["fielders_choice","sac_fly","sac_bunt"].includes(last.eventType)) add("WALKOFF_SPECIAL_PLAY", last, `${prefix}サヨナラ特殊プレー`, { eventType:last.eventType });
  }
  return records;
};
const makeRecord = (year, game, item, names, readings) => {
  const side = item.play.halfInning === "top" ? "away" : "home";
  const opponentSide = side === "away" ? "home" : "away";
  const teamId = Number(game?.teams?.[side]?.team?.id), opponentId = Number(game?.teams?.[opponentSide]?.team?.id);
  const [teamCode, teamName] = TEAM[teamId] ?? [String(teamId), game?.teams?.[side]?.team?.name ?? ""];
  const [opponentCode, opponentName] = TEAM[opponentId] ?? [String(opponentId), game?.teams?.[opponentSide]?.team?.name ?? ""];
  const playerId = item.play.batterId;
  const date = String(game.officialDate); const awaySlug = SLUG[Number(game?.teams?.away?.team?.id)];
  const homeSlug = SLUG[Number(game?.teams?.home?.team?.id)];
  const record = { recordType:item.recordType, aliases:ALIASES[item.recordType] ?? [], category:"individual",
    date, season:year, gameType:game.gameType || "R", gamePk:Number(game.gamePk), playerId,
    playerName:readings[playerNameKey(item.play.batterName)] || names.get(playerId) || item.play.batterName,
    teamId, teamCode, teamName, opponentId,
    opponentCode, opponentName, inning:item.play.inning, gameDate:date, battingSide:side, pitchingSide:null,
    fact:item.fact, description:item.fact, details:item.details, evidence:"MLB公式PBP",
    apiStatus:"confirmed", apiConfirmed:true, historicalContext:{status:"needs-review",text:"",sources:[]},
    gamedayUrl:awaySlug && homeSlug ? `https://www.mlb.com/gameday/${awaySlug}-vs-${homeSlug}/${date.replaceAll("-","/")}/${game.gamePk}/final` : "",
    articleUrls:[], feedUpdatedAt:"", ruleVersion:RULE_VERSION, isJapanesePlayer:false };
  record.uniqueKey = record.archiveKey = recordKey(record); return record;
};

const main = async () => {
  const master = await read(PLAYER_NAMES, { players:{} });
  const names = new Map(Object.entries(master.players ?? {}).map(([id, value]) => [Number(id), value?.displayName || value?.fullName || value?.name]));
  const readingsSource = await fs.readFile(PLAYER_READINGS, "utf8");
  const readingsMatch = readingsSource.match(/const NHK_PLAYER_NAMES = (\{.*\});/);
  if (!readingsMatch) throw new Error("NHK player-name dictionary could not be read");
  const readings = JSON.parse(readingsMatch[1]);
  const report = { schemaVersion:1, ruleVersion:RULE_VERSION, years, generatedAt:"", byYear:{}, totalCandidates:0, totalRecords:0 };
  for (const year of years) {
    console.log(`${year}: loading schedule and candidate players`);
    const [games, pinchGamePks] = await Promise.all([scheduleForYear(year), pinchHomerGamePks(year)]);
    const gamesByPk = new Map(games.map((game) => [Number(game.gamePk), game]));
    const candidates = [...new Set([
      ...games.filter(isWalkoffCandidate).map((game) => Number(game.gamePk)), ...pinchGamePks
    ])].filter((gamePk) => gamesByPk.has(gamePk));
    let completed = 0;
    const generated = (await mapConcurrent(candidates, 5, async (gamePk) => {
      const payload = await fetchJson(`${API}/game/${gamePk}/playByPlay`); completed += 1;
      if (completed % 25 === 0) console.log(`${year}: PBP ${completed}/${candidates.length}`);
      return detect(gamesByPk.get(gamePk), payload).map((item) =>
        makeRecord(year, gamesByPk.get(gamePk), item, names, readings));
    })).flat();
    const file = path.join(RECORDS, `${year}.json`); const prior = await read(file, []);
    const preserved = prior.filter((record) => record.ruleVersion !== RULE_VERSION);
    const merged = [...new Map([...preserved, ...generated].map((record) => [recordKey(record), record])).values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.gamePk) - Number(b.gamePk) || recordKey(a).localeCompare(recordKey(b)));
    await write(file, merged);
    const byType = {}; generated.forEach((record) => { byType[record.recordType] = (byType[record.recordType] || 0) + 1; });
    report.byYear[year] = { games:games.length, candidates:candidates.length, records:generated.length, byType };
    report.totalCandidates += candidates.length; report.totalRecords += generated.length;
    console.log(`${year}: wrote ${generated.length} PBP records from ${candidates.length} candidates`);
  }
  report.generatedAt = new Date().toISOString(); await write(REPORT, report); console.log(JSON.stringify(report, null, 2));
};

await main();
