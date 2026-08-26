#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ROOT, "data", "game-base", "years");
const OUTPUT = path.join(ROOT, "data", "records", "game-base-phase2-11-audit.json");
const PLAYER_MASTER = JSON.parse(await fs.readFile(path.join(ROOT,"data","game-base","cache","player-names.json"),"utf8"));
const YEARS = Array.from({ length: 58 }, (_, i) => 1964 + i);
const RECORD_NAMES=new Map();for(const year of YEARS){const rows=JSON.parse(await fs.readFile(path.join(ROOT,"data","records","backfill",`${year}.json`),"utf8"));for(const r of rows)if(r.playerId&&r.playerName&&!/^選手ID/.test(r.playerName))RECORD_NAMES.set(Number(r.playerId),r.playerName);}
const GAME = ["gamePk","officialDate","gameType","gameNumber","doubleHeader","statusCoded","statusCode","statusDetailed","statusReason","finalEligible","scheduledInnings","playedInnings","completedEarly","shortenedState","awayTeamId","homeTeamId","awayScore","homeScore","endpointAvailability","missingMask","away","home","innings","walkoffCandidate","walkoff","walkoffSource","officialNoHitterEligible","perfectGameCandidate","linescoreSource","metadataSource"];
const TEAM = ["teamId","R","H","2B","3B","HR","RBI","AB","PA","BB","IBB","HBP","SO","SB","CS","GIDP","totalBases","errors","LOB","teamPitchingOuts","missingMask","pitchers","batters"];
const PITCHER = ["playerId","pitcherOrder","gamesPlayed","gamesStarted","starter","starterSource","inningsPitchedRaw","outs","battersFaced","H","R","ER","BB","IBB","HBP","SO","HR","pitches","strikes","wins","losses","saves","completeGames","shutouts","wildPitches","balks","completedGameDerived","shutoutDerived","gamePositions","primaryPositionCode","primaryPositionType","positionSource","positionResolved","missingMask","notApplicableMask"];
const BATTER = ["playerId","gamesPlayed","battingOrderRaw","gamePositions","PA","AB","R","H","2B","3B","HR","RBI","BB","IBB","HBP","SO","SB","CS","GIDP","totalBases","E","PO","A","missingMask"];
const INNING = ["inningNumber","awayRuns","awayHits","awayErrors","homeRuns","homeHits","homeErrors","missingMask"];
const BATTER_FIELDS = ["PA","AB","R","H","2B","3B","HR","RBI","BB","IBB","HBP","SO","SB","CS","GIDP","totalBases","battingOrderRaw","gamePositions"];
const REQUIREMENTS = {
  FOUR_HR_GAME:["HR"], SEVEN_HIT_GAME:["H"], TEN_RBI_GAME:["RBI"], FIVE_SB_GAME:["SB"], FOUR_DOUBLE_GAME:["2B"], THREE_TRIPLE_GAME:["3B"],
  SOLO_NO_HITTER:["officialNoHitterEligible","scheduledInnings","playedInnings","shortenedState","pitcherCount","completedGameDerived","pitcherOuts","pitcherH"],
  SHUTOUT:["pitcherCount","completedGameDerived","opponentR"], ONE_HIT_COMPLETE_GAME:["pitcherCount","completedGameDerived","pitcherH"],
  NO_WALK_SHUTOUT:["pitcherCount","completedGameDerived","opponentR","pitcherBB"], FIFTEEN_STRIKEOUT_GAME:["pitcherSO"], TWENTY_STRIKEOUT_GAME:["pitcherSO"], MADDUX:["pitcherCount","completedGameDerived","opponentR","pitches"],
  POSITION_PLAYER_SCORELESS:["gamePositions","primaryPosition","pitcherR"], POSITION_PLAYER_TWO_INNINGS:["gamePositions","primaryPosition","pitcherOuts"], POSITION_PLAYER_NO_HIT:["gamePositions","primaryPosition","pitcherH"],
  HOMER_AND_PITCH:["batterHR"], MULTI_HIT_AND_PITCH:["batterH"], HOMER_AND_WIN:["batterHR","pitcherWins"], HOMER_AND_SAVE:["batterHR","pitcherSaves"],
  TEN_RUN_INNING:["inningRuns"], TWENTY_RUN_GAME:["teamR"], TWENTY_FIVE_RUN_GAME:["teamR"], TWENTY_HIT_TEAM_GAME:["teamH"], SIX_HR_TEAM_GAME:["teamHR"], TEN_COMBINED_HR:["bothTeamHR"], THIRTY_COMBINED_STRIKEOUTS:["bothTeamSO"], NO_HIT_WIN:["teamR","teamH","opponentR"], TEN_RUN_COMEBACK:["inningRuns","finalScore"], NINTH_INNING_FIVE_RUN_COMEBACK:["inningRuns","finalScore"], FIFTEEN_INNING_GAME:["playedInnings"], EIGHTEEN_INNING_GAME:["playedInnings"]
};

const unpack = (cols, row) => Object.fromEntries(cols.map((key, i) => [key, row?.[i] ?? null]));
const decodeMask = (cols, mask) => Array.isArray(mask) ? mask.map((x) => typeof x === "number" ? cols[x] : x).filter(Boolean) : [];
const decode = (source, row) => {
  const C = source.columns; const g = unpack(C.game, row); g.missingMask = decodeMask(C.game, g.missingMask);
  const team = (raw) => { const t=unpack(C.team,raw);t.missingMask=decodeMask(C.team,t.missingMask);t.batters=(t.batters??[]).map((x)=>{const b=unpack(C.batter,x);b.missingMask=decodeMask(C.batter,b.missingMask);return b;});t.pitchers=(t.pitchers??[]).map((x)=>{const p=unpack(C.pitcher,x);p.missingMask=decodeMask(C.pitcher,p.missingMask);p.notApplicableMask=decodeMask(C.pitcher,p.notApplicableMask);return p;});return t;};
  g.away=team(g.away);g.home=team(g.home);g.innings=(g.innings??[]).map((x)=>{const i=unpack(C.inning,x);i.missingMask=decodeMask(C.inning,i.missingMask);return i;});return g;
};
const state = (row, field) => {
  if ((row?.missingMask??[]).includes(field) || row?.[field] === undefined) return "missing";
  if (row?.[field] === null) return "null";
  if (Array.isArray(row?.[field]) && row[field].length === 0) return "zero";
  if (row?.[field] === 0) return "zero";
  return "present";
};
const inc = (o,k,n=1) => o[k]=(o[k]||0)+n;
const band = (y) => y < 1970 ? "1964-1969" : y < 1980 ? "1970-1979" : y < 1990 ? "1980-1989" : y < 2000 ? "1990-1999" : y < 2010 ? "2000-2009" : "2010-2021";
const lineReason = (g) => {
  if(!g.innings.length)return ["innings-array-empty"];
  const reasons=[];
  for(const inn of g.innings){if(inn.awayRuns==null)reasons.push("away-inning-runs-null-or-missing");if(inn.homeRuns==null){const notPlayed=inn===g.innings.at(-1)&&g.homeScore>g.awayScore;if(!notPlayed)reasons.push("home-inning-runs-null-or-missing");}}
  return [...new Set(reasons)];
};
const reasons = (g, type) => {
  if(g.finalEligible!==true)return [];
  const missing=[];const teams=[g.away,g.home];const pitchers=teams.flatMap(t=>t.pitchers);const batters=teams.flatMap(t=>t.batters);
  const unavailable=(row,f)=>row==null||state(row,f)==="missing"||state(row,f)==="null";
  const batterField={FOUR_HR_GAME:"HR",SEVEN_HIT_GAME:"H",TEN_RBI_GAME:"RBI",FIVE_SB_GAME:"SB",FOUR_DOUBLE_GAME:"2B",THREE_TRIPLE_GAME:"3B"}[type];
  if(batterField&&(!batters.length||batters.every(b=>unavailable(b,batterField))))return [batterField];
  if(["TEN_RUN_INNING","TEN_RUN_COMEBACK","NINTH_INNING_FIVE_RUN_COMEBACK"].includes(type)&&lineReason(g).length)return ["inningRuns"];
  if(["FIFTEEN_INNING_GAME","EIGHTEEN_INNING_GAME"].includes(type)&&g.playedInnings==null)return ["playedInnings"];
  for(const t of teams){
    if(["SOLO_NO_HITTER","SHUTOUT","ONE_HIT_COMPLETE_GAME","NO_WALK_SHUTOUT","MADDUX"].includes(type)&&t.pitchers.length===1){const p=t.pitchers[0],opp=t===g.away?g.home:g.away;if(p.completedGameDerived==null)missing.push("completedGameDerived");if(type==="SOLO_NO_HITTER"&&p.H==null)missing.push("pitcherH");if(type==="ONE_HIT_COMPLETE_GAME"&&p.H==null)missing.push("pitcherH");if(["SHUTOUT","NO_WALK_SHUTOUT","MADDUX"].includes(type)&&opp.R==null)missing.push("opponentR");if(type==="NO_WALK_SHUTOUT"&&p.BB==null)missing.push("pitcherBB");if(type==="MADDUX"&&p.completedGameDerived===true&&opp.R===0&&p.pitches==null)missing.push("pitches");}
    if(["POSITION_PLAYER_SCORELESS","POSITION_PLAYER_TWO_INNINGS","POSITION_PLAYER_NO_HIT"].includes(type))for(const p of t.pitchers.filter(p=>Array.isArray(p.gamePositions)&&p.gamePositions.some(x=>!["1","P","Pitcher"].includes(String(x))))){if(p.positionResolved!==true||p.primaryPositionType==null)missing.push("primaryPosition");}
    // A pitcher with no batting-stat object did not appear as a batter; that is a
    // valid negative, not missing evidence for the same-game batting/pitching rules.
  }
  if(["FIFTEEN_STRIKEOUT_GAME","TWENTY_STRIKEOUT_GAME"].includes(type)&&pitchers.length&&pitchers.every(p=>p.SO==null))missing.push("pitcherSO");
  return [...new Set(missing)];
};

const report={schemaVersion:1,generatedAt:new Date().toISOString(),totalGames:0,playerNames:{masterCount:Object.keys(PLAYER_MASTER.players??{}).length,unresolved:PLAYER_MASTER.unresolved??[]},byYear:{},byEra:{},batterFields:{},recordTypes:{},linescore:{totalMissing:0,reasons:{},byYear:{}},comeback:{totalUnable:0,reasons:{},byYear:{}},madduxMissingPitchGames:[],compactDecodeSamples:{},zeroMissingAudit:{zeroValues:0,zeroMarkedMissing:0,examples:[]}};
for(const f of BATTER_FIELDS)report.batterFields[f]={present:0,zero:0,null:0,missing:0,notApplicable:0};
for(const type of Object.keys(REQUIREMENTS))report.recordTypes[type]={completeGames:0,insufficientGames:0,reasons:{}};
for(const year of YEARS){
  const source=JSON.parse(await fs.readFile(path.join(BASE,`${year}.json`),"utf8")); const yr={games:0,batterRows:0,batterFields:{},linescoreMissing:0,comebackUnable:0}; for(const f of BATTER_FIELDS)yr.batterFields[f]={present:0,zero:0,null:0,missing:0,notApplicable:0};
  for(const row of source.games){const g=decode(source,row);report.totalGames++;yr.games++;
    const batters=[...g.away.batters,...g.home.batters];yr.batterRows+=batters.length;
    for(const b of batters)for(const f of BATTER_FIELDS){const s=state(b,f);inc(report.batterFields[f],s);inc(yr.batterFields[f],s);if(b[f]===0){report.zeroMissingAudit.zeroValues++;if((b.missingMask??[]).includes(f)){report.zeroMissingAudit.zeroMarkedMissing++;if(report.zeroMissingAudit.examples.length<10)report.zeroMissingAudit.examples.push({gamePk:g.gamePk,playerId:b.playerId,field:f});}}}
    const lineReasons=lineReason(g);if(g.endpointAvailability?.[1]===false||g.endpointAvailability?.linescore===false)lineReasons.push("linescore-endpoint-unavailable");if(lineReasons.length){report.linescore.totalMissing++;yr.linescoreMissing++;for(const x of [...new Set(lineReasons)])inc(report.linescore.reasons,x);}
    const comebackReasons=[...lineReasons];if(g.awayScore==null||g.homeScore==null)comebackReasons.push("final-score-missing");if(g.finalEligible!==true)comebackReasons.push("finalEligible-false");if(g.shortenedState&&g.shortenedState!==0)comebackReasons.push("shortened");if(comebackReasons.length){report.comeback.totalUnable++;yr.comebackUnable++;for(const x of [...new Set(comebackReasons)])inc(report.comeback.reasons,x);}
    for(const type of Object.keys(REQUIREMENTS)){const why=reasons(g,type);if(why.length){report.recordTypes[type].insufficientGames++;for(const x of why)inc(report.recordTypes[type].reasons,x);}else report.recordTypes[type].completeGames++;}
    for(const side of ["away","home"])for(const p of g[side].pitchers){if(p.completedGameDerived===true&&g[side==="away"?"home":"away"].R===0&&p.pitches==null)report.madduxMissingPitchGames.push({year,gamePk:g.gamePk,playerId:p.playerId,playerName:RECORD_NAMES.get(Number(p.playerId))??PLAYER_MASTER.players?.[p.playerId]?.displayName??PLAYER_MASTER.players?.[p.playerId]?.fullName??"",outs:p.outs,numberOfPitches:p.pitches,shutout:true,impact:"MADDUX only; SHUTOUT remains decidable"});}
  }
  report.byYear[year]=yr;report.linescore.byYear[year]=yr.linescoreMissing;report.comeback.byYear[year]=yr.comebackUnable;
  const sampleIndexes=[0,Math.floor(source.games.length/2),source.games.length-1].filter((x,i,a)=>x>=0&&a.indexOf(x)===i);if([1964,1979,1999,2021].includes(year))report.compactDecodeSamples[year]=sampleIndexes.map(i=>{const raw=source.games[i],g=decode(source,raw);return{gamePk:g.gamePk,arrayLength:raw.length,expectedColumns:source.columns.game.length,gamePkMatches:raw[source.columns.game.indexOf("gamePk")]===g.gamePk,awayTeamId:g.away.teamId,homeTeamId:g.home.teamId,batterRows:g.away.batters.length+g.home.batters.length,inningRows:g.innings.length,maskNamesValid:[...g.missingMask,...g.away.missingMask,...g.home.missingMask].every(x=>typeof x==="string")};});
}
for(const y of YEARS){const e=band(y);const yr=report.byYear[y];report.byEra[e]??={games:0,batterRows:0,linescoreMissing:0,comebackUnable:0,batterFields:{}};const out=report.byEra[e];out.games+=yr.games;out.batterRows+=yr.batterRows;out.linescoreMissing+=yr.linescoreMissing;out.comebackUnable+=yr.comebackUnable;for(const f of BATTER_FIELDS){out.batterFields[f]??={present:0,zero:0,null:0,missing:0,notApplicable:0};for(const s of ["present","zero","null","missing","notApplicable"])out.batterFields[f][s]+=yr.batterFields[f][s];}}
await fs.writeFile(OUTPUT,`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({output:OUTPUT,totalGames:report.totalGames,linescoreMissing:report.linescore.totalMissing,comebackUnable:report.comeback.totalUnable,madduxMissing:report.madduxMissingPitchGames.length,zeroMarkedMissing:report.zeroMissingAudit.zeroMarkedMissing},null,2));
