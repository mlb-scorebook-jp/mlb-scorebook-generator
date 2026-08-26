#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ROOT, "data", "game-base", "years");
const RECORDS = path.join(ROOT, "data", "records", "backfill");
const REPORT = path.join(ROOT, "data", "records", "game-base-phase1-report.json");
const YEARS = Array.from({ length: 58 }, (_, index) => 1964 + index);
const RULE_VERSION = "daily-records-game-base-phase1-v1";

const TEAM = Object.freeze({
  108:["LAA","Los Angeles Angels"],109:["ARI","Arizona Diamondbacks"],110:["BAL","Baltimore Orioles"],111:["BOS","Boston Red Sox"],112:["CHC","Chicago Cubs"],113:["CIN","Cincinnati Reds"],114:["CLE","Cleveland Guardians"],115:["COL","Colorado Rockies"],116:["DET","Detroit Tigers"],117:["HOU","Houston Astros"],118:["KC","Kansas City Royals"],119:["LAD","Los Angeles Dodgers"],120:["WSH","Washington Nationals"],121:["NYM","New York Mets"],133:["ATH","Athletics"],134:["PIT","Pittsburgh Pirates"],135:["SD","San Diego Padres"],136:["SEA","Seattle Mariners"],137:["SF","San Francisco Giants"],138:["STL","St. Louis Cardinals"],139:["TB","Tampa Bay Rays"],140:["TEX","Texas Rangers"],141:["TOR","Toronto Blue Jays"],142:["MIN","Minnesota Twins"],143:["PHI","Philadelphia Phillies"],144:["ATL","Atlanta Braves"],145:["CWS","Chicago White Sox"],146:["MIA","Miami Marlins"],147:["NYY","New York Yankees"],158:["MIL","Milwaukee Brewers"]
});
const SLUG = Object.freeze({108:"angels",109:"d-backs",110:"orioles",111:"red-sox",112:"cubs",113:"reds",114:"guardians",115:"rockies",116:"tigers",117:"astros",118:"royals",119:"dodgers",120:"nationals",121:"mets",133:"athletics",134:"pirates",135:"padres",136:"mariners",137:"giants",138:"cardinals",139:"rays",140:"rangers",141:"blue-jays",142:"twins",143:"phillies",144:"braves",145:"white-sox",146:"marlins",147:"yankees",158:"brewers"});
const ALIASES = Object.freeze({
  FOUR_HR_GAME:["1試合4本塁打","4本塁打","4HR","four homer game"],
  SEVEN_HIT_GAME:["1試合7安打","7安打","5安打","6安打","seven hit game"],
  TEN_RBI_GAME:["1試合10打点","10打点","大量打点"], FIVE_SB_GAME:["1試合5盗塁","5盗塁","4盗塁"],
  FOUR_DOUBLE_GAME:["1試合4二塁打","4二塁打"], THREE_TRIPLE_GAME:["1試合3三塁打","3三塁打"],
  SOLO_NO_HITTER:["ノーヒットノーラン","ノーヒッター","単独ノーヒッター","no hitter","no-hitter"],
  SHUTOUT:["完封","完封勝利","shutout"], ONE_HIT_COMPLETE_GAME:["1安打完投","1安打完封","one hitter"],
  NO_WALK_SHUTOUT:["無四球完封","四球なし完封"], FIFTEEN_STRIKEOUT_GAME:["15奪三振","15K","20奪三振"],
  TWENTY_STRIKEOUT_GAME:["20奪三振","20K","15奪三振"], MADDUX:["100球未満完封","マダックス","Maddux"],
  POSITION_PLAYER_SCORELESS:["野手登板で無失点"], POSITION_PLAYER_TWO_INNINGS:["野手登板で2イニング","野手登板で2回"],
  POSITION_PLAYER_NO_HIT:["野手登板で被安打0","野手登板でノーヒット"], HOMER_AND_PITCH:["本塁打＋登板","ホームランと登板"],
  MULTI_HIT_AND_PITCH:["複数安打＋登板"], HOMER_AND_WIN:["本塁打＋勝利投手"], HOMER_AND_SAVE:["本塁打＋セーブ"],
  TEN_RUN_INNING:["1イニング10得点","大量得点イニング"], TWENTY_RUN_GAME:["チーム20得点","20得点","25得点"],
  TWENTY_FIVE_RUN_GAME:["チーム25得点","25得点","20得点"], TWENTY_HIT_TEAM_GAME:["チーム20安打","20安打"],
  SIX_HR_TEAM_GAME:["チーム6本塁打","6本塁打"], TEN_COMBINED_HR:["両軍合計10本塁打","10本塁打"],
  THIRTY_COMBINED_STRIKEOUTS:["両軍合計30奪三振","30奪三振"], NO_HIT_WIN:["無安打で勝利","0安打で勝利"],
  TEN_RUN_COMEBACK:["10点差から逆転勝利","10点差逆転"], NINTH_INNING_FIVE_RUN_COMEBACK:["9回5点差から逆転勝利","9回開始時5点差"],
  FIFTEEN_INNING_GAME:["延長15回","15回","延長18回"], EIGHTEEN_INNING_GAME:["延長18回","18回","延長15回"]
});

const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const write = async (file, value) => { const tmp=`${file}.tmp-${process.pid}`; const body=`${JSON.stringify(value,null,2)}\n`; JSON.parse(body); await fs.writeFile(tmp,body); await fs.rename(tmp,file); };
const unpack = (columns,row) => Object.fromEntries(columns.map((key,index)=>[key,row[index]??null]));
const missing = (row, field) => row == null || row[field] == null || (row.missingMask??[]).includes(field);
const ip = (outs) => `${Math.floor(outs/3)}.${outs%3}`;
const inningRuns = (g, inning, side) => {
  const value = side === "away" ? inning.awayRuns : inning.homeRuns;
  if (value != null) return { value, notPlayed: false };
  const isLast = inning === g.innings.at(-1);
  const homeDidNotBat = side === "home" && isLast && g.homeScore > g.awayScore;
  return homeDidNotBat ? { value: null, notPlayed: true } : { value: null, notPlayed: false };
};
const nameMaps = async () => {
  const players=new Map(), games=new Map(), teams=new Map(), japanese=new Set();
  for(const year of YEARS){for(const r of await read(path.join(RECORDS,`${year}.json`))){
    if(r.playerId&&r.playerName&&!/^選手ID/.test(r.playerName))players.set(Number(r.playerId),r.playerName);
    if(r.playerId&&r.isJapanesePlayer)japanese.add(Number(r.playerId));
    if(r.gamePk)games.set(Number(r.gamePk),r);
    if(r.teamId)teams.set(Number(r.teamId),[r.teamCode,r.teamName]); if(r.opponentId)teams.set(Number(r.opponentId),[r.opponentCode,r.opponentName]);
  }} return {players,games,teams,japanese};
};
const main = async () => {
 const maps=await nameMaps(); const counts={},insufficient={},unresolved=new Set(),duplicates={}; let added=0;
 for(const year of YEARS){
  const source=await read(path.join(BASE,`${year}.json`)); const C=source.columns;
  const games=source.games.map((row)=>{const g=unpack(C.game,row);g.away=team(unpack(C.team,g.away),C);g.home=team(unpack(C.team,g.home),C);g.innings=(g.innings??[]).map(x=>unpack(C.inning,x));return g;});
  const prior=await read(path.join(RECORDS,`${year}.json`));
  const preserved=prior.filter((record)=>record.ruleVersion!==RULE_VERSION); const generated=[];
  const add=(g,type,side,{player=null,fact,details={},category="individual",inning=null,evidence="game-base v1"}={})=>{
    const t=g[side],o=g[side==="away"?"home":"away"],pid=player?.playerId??null;
    if(pid&&!maps.players.has(Number(pid)))unresolved.add(Number(pid)); const historic=maps.games.get(Number(g.gamePk));
    const awaySlug=SLUG[g.away.teamId],homeSlug=SLUG[g.home.teamId];
    const gameday=awaySlug&&homeSlug?`https://www.mlb.com/gameday/${awaySlug}-vs-${homeSlug}/${String(g.officialDate).replaceAll("-","/")}/${g.gamePk}/final`:"";
    const isJapanese=pid?maps.japanese.has(Number(pid)):false;
    generated.push({recordType:type,aliases:ALIASES[type]??[],category:isJapanese?"japanese":category,date:g.officialDate,season:year,gameType:g.gameType||"R",gamePk:Number(g.gamePk),playerId:pid,playerName:pid?(maps.players.get(Number(pid))||`選手ID ${pid}`):"",teamId:t.teamId,teamCode:(maps.teams.get(t.teamId)||TEAM[t.teamId]||[String(t.teamId),""])[0],teamName:(maps.teams.get(t.teamId)||TEAM[t.teamId]||["",""])[1],opponentId:o.teamId,opponentCode:(maps.teams.get(o.teamId)||TEAM[o.teamId]||[String(o.teamId),""])[0],opponentName:(maps.teams.get(o.teamId)||TEAM[o.teamId]||["",""])[1],inning,gameDate:g.officialDate,battingSide:category==="individual"?side:null,pitchingSide:type.includes("STRIKEOUT")||type.includes("SHUTOUT")||type.includes("NO_HITTER")||type==="MADDUX"?side:null,fact,description:fact,details,evidence,apiStatus:"confirmed",apiConfirmed:true,historicalContext:{status:"needs-review",text:"",sources:[]},gamedayUrl:historic?.gamedayUrl||gameday,articleUrls:[],feedUpdatedAt:"",ruleVersion:RULE_VERSION,isJapanesePlayer:isJapanese});
  };
  for(const g of games){detect(g,add,insufficient);}
  const all=[...preserved,...generated]; for(const r of all){r.uniqueKey=r.archiveKey=key(r);}
  const merged=[...new Map(all.map(r=>[r.uniqueKey,r])).values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.gamePk-b.gamePk||a.uniqueKey.localeCompare(b.uniqueKey));
  duplicates[year]=all.length-merged.length; await write(path.join(RECORDS,`${year}.json`),merged); added+=generated.length;
  for(const r of generated)counts[r.recordType]=(counts[r.recordType]||0)+1;
 }
 const insufficientCounts=Object.fromEntries(Object.entries(insufficient).map(([type,ids])=>[type,ids.size]));
 const generatedRecords=Object.values(counts).reduce((sum,value)=>sum+value,0);
 await write(REPORT,{schemaVersion:1,ruleVersion:RULE_VERSION,years:[1964,2021],generatedAt:new Date().toISOString(),generatedRecords,addedThisRun:added,byRecordType:counts,insufficientData:insufficientCounts,unresolvedPlayerIds:[...unresolved].sort((a,b)=>a-b),unresolvedPlayerCount:unresolved.size,duplicateUniqueKeysRemoved:duplicates});
 console.log(JSON.stringify({generatedRecords,addedThisRun:added,byRecordType:counts,insufficientData:insufficientCounts,unresolvedPlayerCount:unresolved.size},null,2));
};
const team=(t,C)=>{t.pitchers=(t.pitchers??[]).map(x=>unpack(C.pitcher,x));t.batters=(t.batters??[]).map(x=>unpack(C.batter,x));return t;};
const key=(r)=>[r.recordType,r.gamePk,r.playerId||`team-${r.teamId}`,r.inning||0,r.details?.metric||""].join(":");
const posPlayer=(p)=>{if(!Array.isArray(p.gamePositions))return null;const nonPitcher=p.gamePositions.some(x=>!["1","P","Pitcher"].includes(String(x)));if(!nonPitcher)return false;if(!p.positionResolved||p.primaryPositionType==null)return null;const primary=String(p.primaryPositionType).toLowerCase(),code=String(p.primaryPositionCode||"").toUpperCase();if(primary==="pitcher"||primary.includes("two-way")||code==="Y")return false;return true;};
const detect=(g,add,ins)=>{
 const mark=(type)=>(ins[type]??=new Set()).add(Number(g.gamePk));
 if(g.finalEligible!==true)return;
 for(const side of ["away","home"]){const t=g[side],o=g[side==="away"?"home":"away"],won=t.R>o.R;
  for(const b of t.batters){
   for(const [field,type,n,label] of [["HR","FOUR_HR_GAME",4,"本塁打"],["H","SEVEN_HIT_GAME",7,"安打"],["RBI","TEN_RBI_GAME",10,"打点"],["SB","FIVE_SB_GAME",5,"盗塁"],["2B","FOUR_DOUBLE_GAME",4,"二塁打"],["3B","THREE_TRIPLE_GAME",3,"三塁打"]]){if(!missing(b,field)&&b[field]>=n)add(g,type,side,{player:b,fact:`1試合${b[field]}${label}`,details:{[field]:b[field]}});}
  }
  for(const [field,type] of [["HR","FOUR_HR_GAME"],["H","SEVEN_HIT_GAME"],["RBI","TEN_RBI_GAME"],["SB","FIVE_SB_GAME"],["2B","FOUR_DOUBLE_GAME"],["3B","THREE_TRIPLE_GAME"]])if(!t.batters.length||t.batters.every((b)=>missing(b,field)))mark(type);
  for(const p of t.pitchers){
   if(t.pitchers.length===1&&p.completedGameDerived==null){for(const type of ["SOLO_NO_HITTER","SHUTOUT","ONE_HIT_COMPLETE_GAME","NO_WALK_SHUTOUT","MADDUX"])mark(type);}
   if(t.pitchers.length===1&&p.H==null){mark("SOLO_NO_HITTER");mark("ONE_HIT_COMPLETE_GAME");}
   if(t.pitchers.length===1&&o.R==null){mark("SHUTOUT");mark("NO_WALK_SHUTOUT");mark("MADDUX");}
   if(t.pitchers.length===1&&p.BB==null)mark("NO_WALK_SHUTOUT");
   if(p.SO==null){mark("FIFTEEN_STRIKEOUT_GAME");mark("TWENTY_STRIKEOUT_GAME");}
   const complete=p.completedGameDerived===true,shut=complete&&o.R===0;
   if(complete&&p.H===0&&g.officialNoHitterEligible===true&&g.shortenedState===0&&t.pitchers.length===1&&p.outs>=g.scheduledInnings*3)add(g,"SOLO_NO_HITTER",side,{player:p,fact:"ノーヒットノーラン",details:{outs:p.outs}});
   if(shut)add(g,"SHUTOUT",side,{player:p,fact:`${ip(p.outs)}回を完封`,details:{outs:p.outs}});
   if(complete&&p.H===1)add(g,"ONE_HIT_COMPLETE_GAME",side,{player:p,fact:`${ip(p.outs)}回を1安打完投`,details:{outs:p.outs,hits:1,runs:p.R}});
   if(shut&&p.BB===0)add(g,"NO_WALK_SHUTOUT",side,{player:p,fact:"無四球完封",details:{walks:0}});
   if(!missing(p,"SO")&&p.SO>=20)add(g,"TWENTY_STRIKEOUT_GAME",side,{player:p,fact:`${p.SO}奪三振`,details:{strikeouts:p.SO}});else if(!missing(p,"SO")&&p.SO>=15)add(g,"FIFTEEN_STRIKEOUT_GAME",side,{player:p,fact:`${p.SO}奪三振`,details:{strikeouts:p.SO}});
   if(shut){if(missing(p,"pitches"))mark("MADDUX");else if(p.pitches<=99)add(g,"MADDUX",side,{player:p,fact:`${p.pitches}球で完封`,details:{pitches:p.pitches}});}
   const pp=posPlayer(p); if(pp===null){mark("POSITION_PLAYER");continue;} if(pp){if(p.R===0)add(g,"POSITION_PLAYER_SCORELESS",side,{player:p,fact:"野手登板で無失点",details:{outs:p.outs,runs:0},category:"special"});if(p.outs>=6)add(g,"POSITION_PLAYER_TWO_INNINGS",side,{player:p,fact:`野手登板で${ip(p.outs)}回`,details:{outs:p.outs},category:"special"});if(p.H===0)add(g,"POSITION_PLAYER_NO_HIT",side,{player:p,fact:"野手登板で被安打0",details:{hits:0,outs:p.outs},category:"special"});}
   const b=t.batters.find(x=>x.playerId===p.playerId);if(b&&b.HR>=1){add(g,"HOMER_AND_PITCH",side,{player:p,fact:"本塁打＋登板",details:{homeRuns:b.HR,outs:p.outs},category:"special"});if(p.wins>=1)add(g,"HOMER_AND_WIN",side,{player:p,fact:"本塁打＋勝利投手",details:{homeRuns:b.HR},category:"special"});if(p.saves>=1)add(g,"HOMER_AND_SAVE",side,{player:p,fact:"本塁打＋セーブ",details:{homeRuns:b.HR},category:"special"});}if(b&&b.H>=2)add(g,"MULTI_HIT_AND_PITCH",side,{player:p,fact:`${b.H}安打＋登板`,details:{hits:b.H,outs:p.outs},category:"special"});
  }
  for(const inn of g.innings){const half=inningRuns(g,inn,side);if(half.notPlayed)continue;const runs=half.value;if(runs==null){mark("TEN_RUN_INNING");continue;}if(runs>=10)add(g,"TEN_RUN_INNING",side,{fact:`${inn.inningNumber}回${side==="away"?"表":"裏"} 1イニングに${runs}得点`,details:{runs},category:"team",inning:inn.inningNumber});}
  if(t.R==null){mark("TWENTY_RUN_GAME");mark("TWENTY_FIVE_RUN_GAME");mark("NO_HIT_WIN");}
  if(t.H==null){mark("TWENTY_HIT_TEAM_GAME");mark("NO_HIT_WIN");}
  if(t.HR==null)mark("SIX_HR_TEAM_GAME");
  if(t.SO==null)mark("THIRTY_COMBINED_STRIKEOUTS");
  if(t.R>=25)add(g,"TWENTY_FIVE_RUN_GAME",side,{fact:`チーム${t.R}得点`,details:{runs:t.R},category:"team"});else if(t.R>=20)add(g,"TWENTY_RUN_GAME",side,{fact:`チーム${t.R}得点`,details:{runs:t.R},category:"team"});
  if(t.H>=20)add(g,"TWENTY_HIT_TEAM_GAME",side,{fact:`チーム${t.H}安打`,details:{hits:t.H},category:"team"});if(t.HR>=6)add(g,"SIX_HR_TEAM_GAME",side,{fact:`チーム${t.HR}本塁打`,details:{homeRuns:t.HR},category:"team"});if(won&&t.H===0)add(g,"NO_HIT_WIN",side,{fact:"無安打で勝利",details:{runs:t.R},category:"team"});
  if(won&&g.innings.length){let a=0,h=0,maxDef=0,after8=null;for(const inn of g.innings){const ar=inningRuns(g,inn,"away"),hr=inningRuns(g,inn,"home");if(ar.value==null||(!hr.notPlayed&&hr.value==null)){mark("COMEBACK");maxDef=null;break;}if(inn.inningNumber===9)after8=(side==="away"?h-a:a-h);a+=ar.value;if(side==="home")maxDef=Math.max(maxDef,a-h);if(!hr.notPlayed)h+=hr.value;if(side==="away")maxDef=Math.max(maxDef,h-a);}if(maxDef>=10)add(g,"TEN_RUN_COMEBACK",side,{fact:`${maxDef}点差から逆転勝利`,details:{deficit:maxDef},category:"team"});if(after8>=5)add(g,"NINTH_INNING_FIVE_RUN_COMEBACK",side,{fact:`9回${after8}点差から逆転勝利`,details:{deficit:after8},category:"team"});}
 }
 if(g.away.HR==null||g.home.HR==null)mark("TEN_COMBINED_HR");
 if(g.away.HR!=null&&g.home.HR!=null&&g.away.HR+g.home.HR>=10)add(g,"TEN_COMBINED_HR","home",{fact:`両軍合計${g.away.HR+g.home.HR}本塁打`,details:{homeRuns:g.away.HR+g.home.HR},category:"team"});
 if(g.away.SO!=null&&g.home.SO!=null&&g.away.SO+g.home.SO>=30)add(g,"THIRTY_COMBINED_STRIKEOUTS","home",{fact:`両軍合計${g.away.SO+g.home.SO}奪三振`,details:{strikeouts:g.away.SO+g.home.SO},category:"team"});
 if(g.playedInnings==null)mark("EXTRA_INNING_GAME");else if(g.playedInnings>=18)add(g,"EIGHTEEN_INNING_GAME","home",{fact:`延長${g.playedInnings}回`,details:{innings:g.playedInnings},category:"team"});else if(g.playedInnings>=15)add(g,"FIFTEEN_INNING_GAME","home",{fact:`延長${g.playedInnings}回`,details:{innings:g.playedInnings},category:"team"});
};
await main();
