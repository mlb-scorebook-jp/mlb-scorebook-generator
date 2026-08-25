#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_BASE = path.join(ROOT, "data", "game-base");
const AUDITS = path.join(ROOT, "data", "records", "coverage-audits");
const API = "https://statsapi.mlb.com/api";
const SCHEMA_VERSION = 1;
const EXTRACTION_VERSION = "mlb-game-base-b-v2-1";
const argv = process.argv.slice(2);
const value = (name, fallback = "") => { const i = argv.indexOf(`--${name}`); return i < 0 ? fallback : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);
const years = value("years", "1964-2021").split(",").flatMap((part) => {
  const [a, b] = part.split("-").map(Number); if (!b) return [a];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}).filter((y) => Number.isInteger(y) && y >= 1964 && y <= 2021);
const concurrency = Math.max(1, Math.min(5, Number(value("concurrency", "4")) || 4));
const limit = Math.max(0, Number(value("limit", "0")) || 0);
const pilot = flag("pilot");
const resumeTest = flag("resume-test");
const validateOnly = flag("validate-only");
const stopAfterCheckpoint = flag("stop-after-checkpoint");
const BASE = resumeTest ? path.join(PRODUCTION_BASE, "resume-test") : pilot ? path.join(PRODUCTION_BASE, "pilot") : PRODUCTION_BASE;
const userAgent = "mlb-scorebook-generator-game-base/1";
const now = () => new Date().toISOString();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (file, fallback = null) => { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } };
const atomicWrite = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const text = `${JSON.stringify(data)}\n`;
  JSON.parse(text); await fs.writeFile(tmp, text); await fs.rename(tmp, file);
};
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const get = (object, dotted) => dotted.split(".").reduce((v, key) => v?.[key], object);
const present = (object, dotted) => get(object, dotted) !== undefined;
const numeric = (object, dotted) => {
  const v = get(object, dotted); if (v === undefined || v === null || v === "") return v ?? null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const missing = (object, paths) => paths.filter((p) => !present(object, p)).map((p) => p.split(".").at(-1));
const pos = (player) => [...new Set((player?.allPositions ?? []).map((p) => p?.abbreviation || p?.code).filter(Boolean))];
const sumPitchingOuts = (team) => (team?.pitchers ?? []).reduce((sum, id) => sum + Number(team?.players?.[`ID${id}`]?.stats?.pitching?.outs || 0), 0);
const isPitcherPosition = (p) => ["1", "P", "Pitcher"].includes(String(p));
const GAME_COLUMNS=["gamePk","officialDate","gameType","gameNumber","doubleHeader","statusCoded","statusCode","statusDetailed","statusReason","finalEligible","scheduledInnings","playedInnings","completedEarly","shortenedState","awayTeamId","homeTeamId","awayScore","homeScore","endpointAvailability","missingMask","away","home","innings","walkoffCandidate","walkoff","walkoffSource","officialNoHitterEligible","perfectGameCandidate","linescoreSource","metadataSource"];
const TEAM_COLUMNS=["teamId","R","H","2B","3B","HR","RBI","AB","PA","BB","IBB","HBP","SO","SB","CS","GIDP","totalBases","errors","LOB","teamPitchingOuts","missingMask","pitchers","batters"];
const PITCHER_COLUMNS=["playerId","pitcherOrder","gamesPlayed","gamesStarted","starter","starterSource","inningsPitchedRaw","outs","battersFaced","H","R","ER","BB","IBB","HBP","SO","HR","pitches","strikes","wins","losses","saves","completeGames","shutouts","wildPitches","balks","completedGameDerived","shutoutDerived","gamePositions","primaryPositionCode","primaryPositionType","positionSource","positionResolved","missingMask","notApplicableMask"];
const BATTER_COLUMNS=["playerId","gamesPlayed","battingOrderRaw","gamePositions","PA","AB","R","H","2B","3B","HR","RBI","BB","IBB","HBP","SO","SB","CS","GIDP","totalBases","E","PO","A","missingMask"];
const INNING_COLUMNS=["inningNumber","awayRuns","awayHits","awayErrors","homeRuns","homeHits","homeErrors","missingMask"];
const packRow=(columns,object)=>columns.map((key)=>object?.[key]??null);
const encodeMask=(columns,items)=>[...new Set((items??[]).map((name)=>columns.indexOf(name)).filter((n)=>n>=0))];
const packPitcher=(p)=>packRow(PITCHER_COLUMNS,{...p,missingMask:encodeMask(PITCHER_COLUMNS,p.missingMask),notApplicableMask:encodeMask(PITCHER_COLUMNS,p.notApplicableMask)});
const packBatter=(b)=>packRow(BATTER_COLUMNS,{...b,missingMask:encodeMask(BATTER_COLUMNS,b.missingMask)});
const packTeam=(t)=>packRow(TEAM_COLUMNS,{...t,missingMask:encodeMask(TEAM_COLUMNS,t.missingMask),pitchers:t.pitchers.map(packPitcher),batters:t.batters.map(packBatter)});
const packInning=(i)=>packRow(INNING_COLUMNS,{...i,missingMask:encodeMask(INNING_COLUMNS,i.missingMask)});
const packGame=(g)=>packRow(GAME_COLUMNS,{...g,endpointAvailability:[g.endpointAvailability.boxscore,g.endpointAvailability.linescore,g.endpointAvailability.metadata,g.endpointAvailability.pbp],missingMask:encodeMask(GAME_COLUMNS,g.missingMask),away:packTeam(g.away),home:packTeam(g.home),innings:g.innings.map(packInning)});
const unpackRow=(columns,row)=>Object.fromEntries(columns.map((key,index)=>[key,row[index]??null]));
const decodeMask=(columns,value)=>Array.isArray(value)?value.map((item)=>typeof item==="number"?columns[item]:item).filter(Boolean):[];
const unpackPitcher=(row)=>{const p=unpackRow(PITCHER_COLUMNS,row);p.missingMask=decodeMask(PITCHER_COLUMNS,p.missingMask);p.notApplicableMask=decodeMask(PITCHER_COLUMNS,p.notApplicableMask);return p;};
const unpackBatter=(row)=>{const b=unpackRow(BATTER_COLUMNS,row);b.missingMask=decodeMask(BATTER_COLUMNS,b.missingMask);return b;};
const unpackTeam=(row)=>{const t=unpackRow(TEAM_COLUMNS,row);t.missingMask=decodeMask(TEAM_COLUMNS,t.missingMask);t.pitchers=(t.pitchers??[]).map(unpackPitcher);t.batters=(t.batters??[]).map(unpackBatter);return t;};
const unpackInning=(row)=>{const i=unpackRow(INNING_COLUMNS,row);i.missingMask=decodeMask(INNING_COLUMNS,i.missingMask);return i;};
const unpackGame=(row)=>{const g=unpackRow(GAME_COLUMNS,row);const a=g.endpointAvailability??[];g.endpointAvailability={boxscore:a[0],linescore:a[1],metadata:a[2],pbp:a[3]};g.missingMask=decodeMask(GAME_COLUMNS,g.missingMask);g.away=unpackTeam(g.away);g.home=unpackTeam(g.home);g.innings=(g.innings??[]).map(unpackInning);return g;};

let requestCounts = { boxscore: 0, linescore: 0, metadata: 0, pbp: 0, people: 0, retries: 0 };
const fetchJson = async (url, type) => {
  requestCounts[type] += 1; let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": userAgent } });
      if (response.ok) return { ok: true, status: response.status, data: await response.json() };
      last = new Error(`HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) return { ok: false, status: response.status, error: last.message };
    } catch (error) { last = error; }
    if (attempt < 3) { requestCounts.retries += 1; await wait((2 ** attempt) * 500 + Math.floor(Math.random() * 200)); }
  }
  return { ok: false, status: 0, error: last?.message || "fetch failed" };
};

const peopleCacheFile = path.join(BASE, "cache", "people.json");
let peopleCache = await readJson(peopleCacheFile, { version: 1, players: {} });
const resolvePeople = async (ids) => {
  const needed = [...new Set(ids.map(Number).filter(Boolean))].filter((id) => !peopleCache.players[id]);
  for (let i = 0; i < needed.length; i += 50) {
    const batch = needed.slice(i, i + 50);
    const result = await fetchJson(`${API}/v1/people?personIds=${batch.join(",")}&hydrate=currentTeam`, "people");
    if (!result.ok) continue;
    for (const p of result.data?.people ?? []) peopleCache.players[p.id] = {
      primaryPositionCode: p?.primaryPosition?.code ?? null,
      primaryPositionType: p?.primaryPosition?.type ?? null,
      primaryPositionAbbreviation: p?.primaryPosition?.abbreviation ?? null,
      fetchedAt: now()
    };
    await atomicWrite(peopleCacheFile, peopleCache);
  }
};

const statusIsAbnormal = (status) => /forfeit|unplayable|cancel|suspend|postpon/i.test([
  status?.codedGameState, status?.statusCode, status?.detailedState, status?.reason
].filter(Boolean).join(" "));
const fetchMetadata = (gamePk) => fetchJson(`${API}/v1.1/game/${gamePk}/feed/live?fields=gamePk,gameData,game,datetime,officialDate,gameDate,status,abstractGameState,codedGameState,detailedState,statusCode,reason,teams,away,home,id,doubleHeader,gameNumber,flags,noHitter,perfectGame,liveData,linescore,scheduledInnings,currentInning,innings,num`, "metadata");

const parsePitcher = (player, order, teamOuts, opponentRuns, pitcherCount) => {
  const s = player?.stats?.pitching ?? {};
  const paths = ["gamesPlayed","gamesStarted","inningsPitched","outs","battersFaced","hits","runs","earnedRuns","baseOnBalls","intentionalWalks","hitByPitch","strikeOuts","homeRuns","pitchesThrown","strikes","wins","losses","saves","completeGames","shutouts","wildPitches","balks"];
  const outs = numeric(s, "outs"); const gamesStarted = numeric(s, "gamesStarted");
  const positions = pos(player); const primary = peopleCache.players[player?.person?.id];
  return {
    playerId: Number(player?.person?.id), pitcherOrder: order,
    gamesPlayed: numeric(s,"gamesPlayed"), gamesStarted,
    starter: gamesStarted == null ? (order === 0 ? true : null) : gamesStarted > 0,
    starterSource: gamesStarted == null ? (order === 0 ? "pitcherOrder" : "unknown") : "gamesStarted",
    inningsPitchedRaw: present(s,"inningsPitched") ? s.inningsPitched : null, outs,
    battersFaced: numeric(s,"battersFaced"), H:numeric(s,"hits"), R:numeric(s,"runs"), ER:numeric(s,"earnedRuns"),
    BB:numeric(s,"baseOnBalls"), IBB:numeric(s,"intentionalWalks"), HBP:numeric(s,"hitByPitch"), SO:numeric(s,"strikeOuts"), HR:numeric(s,"homeRuns"),
    pitches:numeric(s,"pitchesThrown"), strikes:numeric(s,"strikes"), wins:numeric(s,"wins"), losses:numeric(s,"losses"), saves:numeric(s,"saves"),
    completeGames:numeric(s,"completeGames"), shutouts:numeric(s,"shutouts"), wildPitches:numeric(s,"wildPitches"), balks:numeric(s,"balks"),
    completedGameDerived: pitcherCount === 1 && outs != null && teamOuts != null ? outs === teamOuts : null,
    shutoutDerived: pitcherCount === 1 && outs != null && teamOuts != null && opponentRuns != null ? outs === teamOuts && opponentRuns === 0 : null,
    gamePositions: positions,
    primaryPositionCode: primary?.primaryPositionCode ?? null, primaryPositionType: primary?.primaryPositionType ?? null,
    positionSource: primary ? "people" : "notRequested", positionResolved: primary ? true : null,
    missingMask: missing(s, paths),
    notApplicableMask: primary ? [] : ["primaryPositionCode", "primaryPositionType", "positionResolved"]
  };
};
const parseBatter = (player) => {
  const s = player?.stats?.batting ?? {};
  const paths=["gamesPlayed","plateAppearances","atBats","runs","hits","doubles","triples","homeRuns","rbi","baseOnBalls","intentionalWalks","hitByPitch","strikeOuts","stolenBases","caughtStealing","groundIntoDoublePlay","totalBases"];
  const f = player?.stats?.fielding ?? {};
  return { playerId:Number(player?.person?.id), gamesPlayed:numeric(s,"gamesPlayed"), battingOrderRaw:present(player,"battingOrder")?String(player.battingOrder):null,
    gamePositions:pos(player), PA:numeric(s,"plateAppearances"), AB:numeric(s,"atBats"), R:numeric(s,"runs"), H:numeric(s,"hits"), "2B":numeric(s,"doubles"), "3B":numeric(s,"triples"), HR:numeric(s,"homeRuns"), RBI:numeric(s,"rbi"), BB:numeric(s,"baseOnBalls"), IBB:numeric(s,"intentionalWalks"), HBP:numeric(s,"hitByPitch"), SO:numeric(s,"strikeOuts"), SB:numeric(s,"stolenBases"), CS:numeric(s,"caughtStealing"), GIDP:numeric(s,"groundIntoDoublePlay"), totalBases:numeric(s,"totalBases"), E:numeric(f,"errors"), PO:numeric(f,"putOuts"), A:numeric(f,"assists"), missingMask:missing(s,paths) };
};
const parseTeam = (team, opponentRuns) => {
  const b=team?.teamStats?.batting??{}, f=team?.teamStats?.fielding??{};
  const fields=["runs","hits","doubles","triples","homeRuns","rbi","atBats","plateAppearances","baseOnBalls","intentionalWalks","hitByPitch","strikeOuts","stolenBases","caughtStealing","groundIntoDoublePlay","totalBases","leftOnBase"];
  const teamOuts=sumPitchingOuts(team); const ids=team?.pitchers??[];
  return { teamId:Number(team?.team?.id), R:numeric(b,"runs"), H:numeric(b,"hits"), "2B":numeric(b,"doubles"), "3B":numeric(b,"triples"), HR:numeric(b,"homeRuns"), RBI:numeric(b,"rbi"), AB:numeric(b,"atBats"), PA:numeric(b,"plateAppearances"), BB:numeric(b,"baseOnBalls"), IBB:numeric(b,"intentionalWalks"), HBP:numeric(b,"hitByPitch"), SO:numeric(b,"strikeOuts"), SB:numeric(b,"stolenBases"), CS:numeric(b,"caughtStealing"), GIDP:numeric(b,"groundIntoDoublePlay"), totalBases:numeric(b,"totalBases"), errors:numeric(f,"errors"), LOB:numeric(b,"leftOnBase"), teamPitchingOuts:teamOuts,
    pitchers:ids.map((id,i)=>parsePitcher(team?.players?.[`ID${id}`],i,teamOuts,opponentRuns,ids.length)),
    batters:(team?.batters??[]).map((id)=>parseBatter(team?.players?.[`ID${id}`])).filter((p)=>p.playerId), missingMask:missing(b,fields) };
};

const analyzePbp = (pbp, game) => {
  const plays=pbp?.allPlays??[]; const final=plays.at(-1);
  if (game.walkoffCandidate && final) {
    const homeBatting=final?.about?.isTopInning===false || final?.about?.halfInning==="bottom";
    const walkoff=homeBatting && Number(final?.about?.inning)===Number(game.playedInnings) && final?.about?.isComplete===true;
    game.walkoff=walkoff; game.walkoffSource="pbpFinalPlay";
  }
};
const fieldCount = (summary, prefix, object) => {
  for (const [k,v] of Object.entries(object??{})) {
    if (["pitchers","batters","innings"].includes(k) || k==="missingMask") continue;
    const key=`${prefix}.${k}`; const row=summary[key]??={present:0,zero:0,null:0,missing:0,notApplicable:0};
    if ((object.notApplicableMask??[]).includes(k)) row.notApplicable++;
    else if ((object.missingMask??[]).includes(k)) row.missing++;
    else if (v===null) row.null++; else { row.present++; if(v===0) row.zero++; }
  }
};

const extractGame = async ({ gamePk, date }) => {
  const [box, line] = await Promise.all([
    fetchJson(`${API}/v1/game/${gamePk}/boxscore`,"boxscore"), fetchJson(`${API}/v1/game/${gamePk}/linescore`,"linescore")
  ]);
  const endpointAvailability={boxscore:box.ok,linescore:line.ok,metadata:false,pbp:false};
  if (!box.ok) throw new Error(`boxscore:${box.status}:${box.error}`);
  const ls=line.data??{}; const innings=Array.isArray(ls.innings)?ls.innings.map((i)=>({inningNumber:numeric(i,"num"),awayRuns:numeric(i,"away.runs"),awayHits:numeric(i,"away.hits"),awayErrors:numeric(i,"away.errors"),homeRuns:numeric(i,"home.runs"),homeHits:numeric(i,"home.hits"),homeErrors:numeric(i,"home.errors"),missingMask:missing(i,["num","away.runs","away.hits","away.errors","home.runs","home.hits","home.errors"])})):[];
  let metadata=null; const scheduled=numeric(ls,"scheduledInnings");
  const needMetadata=!line.ok || !innings.length || scheduled!==9;
  if(needMetadata){const m=await fetchMetadata(gamePk);endpointAvailability.metadata=m.ok;metadata=m.data;}
  const md=metadata?.gameData??{}; const status=md.status??{};
  const awayRuns=numeric(ls,"teams.away.runs")??numeric(box.data,"teams.away.teamStats.batting.runs");
  const homeRuns=numeric(ls,"teams.home.runs")??numeric(box.data,"teams.home.teamStats.batting.runs");
  const abnormal=statusIsAbnormal(status)||(!innings.length&&needMetadata);
  const finalEligible=!abnormal&&box.ok&&line.ok&&innings.length>0;
  const away=parseTeam(box.data?.teams?.away,homeRuns), home=parseTeam(box.data?.teams?.home,awayRuns);
  const candidates=[...away.pitchers,...home.pitchers].filter((p)=>p.gamePositions.some((x)=>!isPitcherPosition(x)));
  for(const p of candidates){
    const pc=peopleCache.players[p.playerId];
    p.notApplicableMask=[];
    if(pc){p.primaryPositionCode=pc.primaryPositionCode;p.primaryPositionType=pc.primaryPositionType;p.positionSource="peopleCache";p.positionResolved=true;}
    else {p.positionSource="peoplePending";p.positionResolved=null;p.missingMask.push("primaryPositionCode","primaryPositionType");}
  }
  const played=innings.length?Math.max(...innings.map((i)=>Number(i.inningNumber)||0)):numeric(ls,"currentInning");
  const shortenedState=scheduled==null||played==null?2:(played<scheduled?1:0);
  const game={schemaVersion:SCHEMA_VERSION,gamePk:Number(gamePk),officialDate:String(date),gameType:md?.game?.type??"R",gameNumber:numeric(md,"game.gameNumber"),doubleHeader:md?.game?.doubleHeader??null,
    statusCoded:status?.codedGameState??null,statusCode:status?.statusCode??null,statusDetailed:status?.detailedState??null,statusReason:status?.reason??null,finalEligible,
    scheduledInnings:scheduled??numeric(md,"game.scheduledInnings")??null,playedInnings:played,completedEarly:/completed early/i.test(status?.detailedState??"")?true:null,shortenedState,
    awayTeamId:away.teamId,homeTeamId:home.teamId,awayScore:awayRuns,homeScore:homeRuns,endpointAvailability,
    missingMask:[],away,home,innings,walkoffCandidate:finalEligible&&homeRuns>awayRuns&&Number(innings.at(-1)?.homeRuns)>0,walkoff:null,walkoffSource:"notChecked",
    officialNoHitterEligible:finalEligible&&scheduled!=null&&played!=null&&played>=scheduled&&scheduled>=9,
    perfectGameCandidate:false,linescoreSource:line.ok?"direct":"missing",metadataSource:metadata?"targetedLiveFeed":"auditIndex"};
  game.missingMask = [
    ["gameNumber", game.gameNumber], ["doubleHeader", game.doubleHeader], ["statusCoded", game.statusCoded],
    ["statusCode", game.statusCode], ["statusDetailed", game.statusDetailed], ["statusReason", game.statusReason],
    ["scheduledInnings", game.scheduledInnings], ["playedInnings", game.playedInnings]
  ].filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  const visitorBF=home.pitchers.reduce((n,p)=>n+(p.battersFaced??0),0), homeBF=away.pitchers.reduce((n,p)=>n+(p.battersFaced??0),0);
  game.perfectGameCandidate=game.officialNoHitterEligible&&(
    (away.H===0&&away.BB===0&&away.HBP===0&&home.errors===0&&visitorBF===27) ||
    (home.H===0&&home.BB===0&&home.HBP===0&&away.errors===0&&homeBF===27)
  );
  const starterUnknown=[...away.pitchers,...home.pitchers].some((p)=>p.starter===null);
  if((game.perfectGameCandidate||!line.ok||starterUnknown)){
    const pbp=await fetchJson(`${API}/v1/game/${gamePk}/playByPlay`,"pbp");endpointAvailability.pbp=pbp.ok;if(pbp.ok)analyzePbp(pbp.data,game);
  }
  return game;
};

const loadIndex = async () => {
  const all=[];
  for(const year of years){const j=await readJson(path.join(AUDITS,`${year}.json`));if(!j)throw new Error(`coverage audit missing: ${year}`);for(const s of j.samples??[])all.push({year,gamePk:Number(s.gamePk),date:s.date});}
  const unique=new Set(all.map((g)=>g.gamePk));
  if(unique.size!==all.length)throw new Error(`Game PK duplicate: ${all.length-unique.size}`);
  return all;
};
const validateYear = async (year,games,expected,failures,fieldCoverage) => {
  const ids=games.map((g)=>g.gamePk);const duplicate=ids.length-new Set(ids).size;
  const errors=[];if(duplicate)errors.push(`duplicate:${duplicate}`);if(games.length+failures.length!==expected)errors.push(`count:${games.length}+${failures.length}!=${expected}`);
  if(games.some((g)=>g.schemaVersion!==1))errors.push("schemaVersion");
  return {valid:errors.length===0,errors,year,expectedGames:expected,savedGames:games.length,failedCount:failures.length,duplicateGamePks:duplicate,fieldCoverage};
};
const writeCompletedYear = async (year,games,report) => {
  games.sort((a,b)=>a.officialDate.localeCompare(b.officialDate)||a.gamePk-b.gamePk);
  const columns={game:GAME_COLUMNS,team:TEAM_COLUMNS,pitcher:PITCHER_COLUMNS,batter:BATTER_COLUMNS,inning:INNING_COLUMNS,endpointAvailability:["boxscore","linescore","metadata","pbp"]};
  const raw=Buffer.from(`${JSON.stringify({schemaVersion:1,extractionVersion:EXTRACTION_VERSION,year,columns,games:games.map(packGame),fieldCoverage:report.fieldCoverage})}\n`);
  const gz=await gzip(raw,{level:9});const br=await brotli(raw,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9}});
  const base=path.join(BASE,"years",String(year));await fs.mkdir(path.dirname(base),{recursive:true});
  const tmp=`${base}.json.tmp-${process.pid}`;await fs.writeFile(tmp,raw);JSON.parse(await fs.readFile(tmp,"utf8"));await fs.rename(tmp,`${base}.json`);
  await fs.writeFile(`${base}.json.gz`,gz);await fs.writeFile(`${base}.json.br`,br);
  report.checksum=sha256(raw);report.fileSize=raw.length;report.gzipSize=gz.length;report.brotliSize=br.length;
  await atomicWrite(path.join(BASE,"reports",`${year}.json`),report);
  return report;
};

const runYear = async (year, index) => {
  const progressFile=path.join(BASE,"progress",`${year}.json`), prior=await readJson(progressFile,{processedGamePks:[],failedGamePks:[],games:[]});
  const processed=new Set(prior.processedGamePks??[]), failures=new Map((prior.failedGamePks??[]).map((f)=>[f.gamePk,f])), games=new Map((prior.games??[]).map((g)=>[g.gamePk,g]));
  let cursor=0,done=0; const targets=limit?index.slice(0,limit):index;
  const resolvePendingPeople = async () => {
    const pitchers=[...games.values()].flatMap((g)=>[...g.away.pitchers,...g.home.pitchers]);
    const pending=pitchers.filter((p)=>p.positionSource==="peoplePending");
    if(!pending.length)return;
    await resolvePeople(pending.map((p)=>p.playerId));
    for(const p of pending){const pc=peopleCache.players[p.playerId];if(!pc)continue;p.primaryPositionCode=pc.primaryPositionCode;p.primaryPositionType=pc.primaryPositionType;p.positionSource="people";p.positionResolved=true;p.missingMask=p.missingMask.filter((x)=>!x.startsWith("primaryPosition"));}
  };
  const checkpoint=async()=>{await resolvePendingPeople();await atomicWrite(progressFile,{schemaVersion:1,year,processedGamePks:[...processed],failedGamePks:[...failures.values()],candidatePbpGamePks:[...games.values()].filter((g)=>g.endpointAvailability?.pbp).map((g)=>g.gamePk),peopleCache:{version:peopleCache.version,count:Object.keys(peopleCache.players).length},updatedAt:now(),games:[...games.values()]});};
  const worker=async()=>{while(cursor<targets.length){const item=targets[cursor++];if(processed.has(item.gamePk))continue;try{const game=await extractGame(item);games.set(item.gamePk,game);processed.add(item.gamePk);failures.delete(item.gamePk);}catch(error){const f=failures.get(item.gamePk);failures.set(item.gamePk,{gamePk:item.gamePk,date:item.date,error:error?.message||String(error),attempts:Number(f?.attempts||0)+1});}done++;if(done%25===0){await checkpoint();process.stdout.write(`\r${year}: ${processed.size}/${targets.length} failed=${failures.size}`);if(stopAfterCheckpoint)return;}}};
  await Promise.all(Array.from({length:Math.min(concurrency,targets.length||1)},worker));await checkpoint();
  if(stopAfterCheckpoint&&processed.size<targets.length)return {partial:true,processed:processed.size,failed:failures.size};
  const fieldCoverage={};for(const g of games.values()){fieldCount(fieldCoverage,"game",g);fieldCount(fieldCoverage,"team",g.away);fieldCount(fieldCoverage,"team",g.home);for(const p of [...g.away.pitchers,...g.home.pitchers])fieldCount(fieldCoverage,"pitcher",p);for(const b of [...g.away.batters,...g.home.batters])fieldCount(fieldCoverage,"batter",b);for(const i of g.innings)fieldCount(fieldCoverage,"inning",i);}
  const saved=[...games.values()], failed=[...failures.values()]; const validation=await validateYear(year,saved,targets.length,failed,fieldCoverage);
  const report={schemaVersion:1,extractionVersion:EXTRACTION_VERSION,generatedAt:now(),...validation,fieldCoverage,requests:{...requestCounts},insufficientDataGames:saved.filter((g)=>!g.endpointAvailability.boxscore||!g.endpointAvailability.linescore||g.scheduledInnings==null||g.playedInnings==null).length,starterUnknown:saved.flatMap((g)=>[...g.away.pitchers,...g.home.pitchers]).filter((p)=>p.starter===null).length,cgMismatch:saved.flatMap((g)=>[...g.away.pitchers,...g.home.pitchers]).filter((p)=>p.completeGames!=null&&p.completedGameDerived!=null&&(p.completeGames>0)!==p.completedGameDerived).length,shoMismatch:saved.flatMap((g)=>[...g.away.pitchers,...g.home.pitchers]).filter((p)=>p.shutouts!=null&&p.shutoutDerived!=null&&(p.shutouts>0)!==p.shutoutDerived).length,positionUnresolved:saved.flatMap((g)=>[...g.away.pitchers,...g.home.pitchers]).filter((p)=>p.positionSource==="peoplePending"||(["people","peopleCache"].includes(p.positionSource)&&!p.positionResolved)).length,scheduledInningsMissing:saved.filter((g)=>g.scheduledInnings==null).length,abnormalFinals:saved.filter((g)=>!g.finalEligible).length,pbpFetched:saved.filter((g)=>g.endpointAvailability.pbp).length,failedGamePks:failed};
  if(!validation.valid)throw new Error(`${year} validation failed: ${validation.errors.join(",")}`);
  await writeCompletedYear(year,saved,report);await fs.rm(progressFile,{force:true});process.stdout.write("\n");return report;
};

const index=await loadIndex();
console.log(JSON.stringify({years:[Math.min(...years),Math.max(...years)],total:index.length,unique:new Set(index.map((g)=>g.gamePk)).size},null,2));
if(validateOnly)process.exit(0);
const pilotIds=new Set([148531,148542,148956,177426,177951,1157,633522,633417,634380,634531]);
const selected=resumeTest?index.filter((g)=>g.year===1964).slice(0,60):pilot?index.filter((g)=>pilotIds.has(g.gamePk)):index;
const reports=[];
for(const year of years){
  const items=selected.filter((g)=>g.year===year);if(!items.length)continue;
  if(!pilot&&!resumeTest){
    const existingReport=await readJson(path.join(BASE,"reports",`${year}.json`));
    const existingYear=await readJson(path.join(BASE,"years",`${year}.json`));
    if(existingReport?.valid&&Array.isArray(existingYear?.games)&&existingYear.games.length===items.length){
      const reusableGames=existingYear.games.length&&Array.isArray(existingYear.games[0])?existingYear.games.map(unpackGame):existingYear.games;
      await writeCompletedYear(year,reusableGames,existingReport);
      reports.push(await readJson(path.join(BASE,"reports",`${year}.json`)));console.log(`${year}: existing validated year reused`);continue;
    }
  }
  reports.push(await runYear(year,items));if(stopAfterCheckpoint)break;
}
const completed=reports.filter((r)=>!r.partial&&r.valid);
const manifestPath=path.join(BASE,pilot?"pilot-manifest.json":"manifest.json");
const priorManifest=await readJson(manifestPath,{});
const yearFiles=[...(priorManifest.yearFiles??[]),...completed.map((r)=>({year:r.year,path:`years/${r.year}.json`,gameCount:r.savedGames,failedCount:r.failedCount,checksum:r.checksum,fileSize:r.fileSize,gzipSize:r.gzipSize,brotliSize:r.brotliSize}))];
const mergedYearFiles=[...new Map(yearFiles.map((r)=>[r.year,r])).values()].sort((a,b)=>a.year-b.year);
const manifest={schemaVersion:1,extractionVersion:EXTRACTION_VERSION,yearRange:{start:Math.min(...years),end:Math.max(...years)},totalGames:index.length,completedGames:mergedYearFiles.reduce((n,r)=>n+r.gameCount,0),failedGames:mergedYearFiles.reduce((n,r)=>n+r.failedCount,0),insufficientDataGames:Number(priorManifest.insufficientDataGames||0)+completed.reduce((n,r)=>n+r.insufficientDataGames,0),createdAt:priorManifest.createdAt??now(),updatedAt:now(),yearFiles:mergedYearFiles,yearChecksums:Object.fromEntries(mergedYearFiles.map((r)=>[r.year,r.checksum])),fieldCoverage:{},peopleCacheVersion:peopleCache.version,requests:Object.fromEntries(Object.keys(requestCounts).map((k)=>[k,Number(priorManifest.requests?.[k]||0)+requestCounts[k]])),pilot};
await atomicWrite(manifestPath,manifest);
console.log(JSON.stringify(manifest,null,2));
