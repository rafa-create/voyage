import test from "node:test";
import assert from "node:assert/strict";
import {syncRecentSports,getCachedSports} from "../worker/sport-sync.js";
import {archiveIndex} from "../worker/parcours-archive.js";

function memoryBucket(){
  const entries=new Map();
  return {get:async key=>entries.has(key)?{json:async()=>entries.get(key)}:null,
    put:async(key,content)=>entries.set(key,JSON.parse(content)),
    delete:async key=>entries.delete(key)};
}
const record=(id,ageDays)=>({
  id:String(id),startedAtMs:Date.now()-ageDays*86400000,elapsed_time:600,
  durationSeconds:600,sportType:"Run",name:"Activité "+id,visibility:"everyone",
  distanceMeters:1500
});
test("après 40 jours : le cache dure sept jours, les anciennes activités sont rattrapées en R2",async()=>{
  const original=globalThis.fetch;
  const first=Array.from({length:100},(_,i)=>record(i+1,2));
  const second=Array.from({length:30},(_,i)=>record(i+101,40));
  const calls=[];
  globalThis.fetch=async input=>{
    const url=String(input);
    calls.push(url);
    if(url.includes("/activities?page=2"))return new Response(JSON.stringify({items:second}),{status:200,
      headers:{"content-type":"application/json"}});
    if(url.includes("/activities/")&&url.endsWith("/route"))
      return new Response(JSON.stringify({geoRoute:[]}),{status:200,
        headers:{"content-type":"application/json"}});
    if(url.endsWith("/activities"))
      return new Response(JSON.stringify({items:first}),{status:200,
        headers:{"content-type":"application/json"}});
    return new Response("",{status:404});
  };
  try{
    const env={PHOTOS_PRIVEES:memoryBucket(),VOYAGE_BRIDGE_KEY:"a".repeat(56)};
    const synced=await syncRecentSports(env,{force:true});
    assert.equal(synced.etat,"actualise");
    assert.equal(synced.backfill.page,2);
    assert.equal(synced.backfill.olderItems,30);
    assert.equal(synced.items.length,100);
    const archives=await archiveIndex(env);
    assert.equal(archives.length,16);
    assert.equal(archives.filter(x=>x.sourceId&&Number(x.sourceId.split(":")[1])>=101).length,8);
    assert.ok(calls.some(url=>url.endsWith("/activities?page=2")));
    const cached=await getCachedSports(env);
    assert.equal(cached.items.length,100);
    assert.ok(archives.some(x=>x.date<cached.items.at(-1).date));
  }finally{globalThis.fetch=original;}
});

test("les activités de 31 jours sont archivées même si le cache récent est vide",async()=>{
  const original=globalThis.fetch;
  const activity=record(5001,31);
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.endsWith("/activities"))
      return new Response(JSON.stringify({items:[activity]}),{status:200,
        headers:{"content-type":"application/json"}});
    if(url.includes("/route"))
      return new Response(JSON.stringify({geoRoute:[]}),{status:200,
        headers:{"content-type":"application/json"}});
    return new Response("",{status:404});
  };
  try{
    const env={PHOTOS_PRIVEES:memoryBucket(),VOYAGE_BRIDGE_KEY:"b".repeat(48)};
    const sync=await syncRecentSports(env,{force:true});
    assert.equal(sync.etat,"actualise");
    assert.equal(sync.items.length,0,"aucune activité de plus d'une semaine dans le cache récent");
    const records=await archiveIndex(env);
    assert.equal(records.length,1);
    assert.equal(records[0].sourceId,"strava:5001");
    assert.equal(records[0].public,true);
    assert.equal(records[0].routeState,"absent");
  }finally{globalThis.fetch=original;}
});
