#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const REPORT=path.join(ROOT,"data","records","game-base-phase1-report.json");
const RECORDS=path.join(ROOT,"data","records","backfill");
const MASTER=path.join(ROOT,"data","game-base","cache","player-names.json");
const YEARS=Array.from({length:58},(_,i)=>1964+i);
const API="https://statsapi.mlb.com/api/v1/people";
const read=async(f,fallback=null)=>{try{return JSON.parse(await fs.readFile(f,"utf8"));}catch{return fallback;}};
const write=async(f,v)=>{const tmp=`${f}.tmp-${process.pid}`;const body=`${JSON.stringify(v,null,2)}\n`;JSON.parse(body);await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(tmp,body);await fs.rename(tmp,f);};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const japaneseSource=await fs.readFile(path.join(ROOT,"js","players.js"),"utf8");vm.runInThisContext(japaneseSource,{filename:"js/players.js"});
const japaneseById=new Map();
for(const year of YEARS)for(const r of await read(path.join(RECORDS,`${year}.json`),[]))if(r.playerId&&r.isJapanesePlayer&&r.playerName&&!/^選手ID/.test(r.playerName))japaneseById.set(Number(r.playerId),r.playerName);
const report=await read(REPORT);const requested=[...new Set(report.unresolvedPlayerIds.map(Number))];
const master=await read(MASTER,{schemaVersion:1,updatedAt:null,players:{},unresolved:[]});
const existing=new Map();
for(const year of YEARS)for(const r of await read(path.join(RECORDS,`${year}.json`),[]))if(r.playerId&&r.playerName&&!/^選手ID/.test(r.playerName))existing.set(Number(r.playerId),r.playerName);
let existingResolved=0,apiResolved=0,apiRequests=0;
for(const id of requested)if(existing.has(id)&&!master.players[id]){master.players[id]={playerId:id,fullName:existing.get(id),displayName:japaneseById.get(id)||existing.get(id),source:"records",fetchedAt:null};existingResolved++;}
const needed=requested.filter(id=>!master.players[id]);
for(let i=0;i<needed.length;i+=50){const ids=needed.slice(i,i+50);let data=null;
  for(let attempt=0;attempt<4&&!data;attempt++){apiRequests++;try{const response=await fetch(`${API}?personIds=${ids.join(",")}`,{headers:{"user-agent":"mlb-scorebook-generator-phase2-11/1"}});if(response.ok)data=await response.json();else if(response.status<500&&response.status!==429)break;}catch{}if(!data)await wait(500*(2**attempt));}
  for(const p of data?.people??[]){const id=Number(p.id);const displayName=japaneseById.get(id)||p.fullName;master.players[id]={playerId:id,fullName:p.fullName??"",firstName:p.firstName??"",lastName:p.lastName??"",displayName,primaryPosition:p.primaryPosition??null,birthDate:p.birthDate??null,active:p.active??null,source:"people-api",fetchedAt:new Date().toISOString()};apiResolved++;}
  await write(MASTER,{...master,updatedAt:new Date().toISOString()});
}
master.unresolved=requested.filter(id=>!master.players[id]).map(playerId=>({playerId,reason:"MLB People API returned no person"}));master.updatedAt=new Date().toISOString();await write(MASTER,master);
let patchedRecords=0,japaneseMaintained=0;
for(const year of YEARS){const file=path.join(RECORDS,`${year}.json`);const rows=await read(file,[]);let changed=false;for(const r of rows){if(!r.playerId||!/^選手ID/.test(r.playerName||""))continue;const p=master.players[Number(r.playerId)];if(!p)continue;const name=japaneseById.get(Number(r.playerId))||p.displayName||p.fullName;if(!name)continue;r.playerName=name;r.aliases=[...new Set([...(r.aliases??[]),p.fullName,p.firstName,p.lastName].filter(Boolean))];changed=true;patchedRecords++;if(japaneseById.has(Number(r.playerId)))japaneseMaintained++;}if(changed)await write(file,rows);}
report.unresolvedPlayerIds=master.unresolved.map(x=>x.playerId);report.unresolvedPlayerCount=master.unresolved.length;report.playerNameResolution={requested:requested.length,existingResolved,apiResolved,apiRequests,patchedRecords,japaneseMaintained,master:"data/game-base/cache/player-names.json",unresolved:master.unresolved};report.generatedAt=new Date().toISOString();await write(REPORT,report);
console.log(JSON.stringify(report.playerNameResolution,null,2));
