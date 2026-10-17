import test from "node:test";
import assert from "node:assert/strict";
import {archiveNewSports} from "../worker/archive-auto.js";
import {archiveIndex,publicArchives} from "../worker/parcours-archive.js";

function fakeBucket(){
  const records=new Map();
  return {get:async key=>records.has(key)?{json:async()=>records.get(key)}:null,
    put:async(key,val)=>records.set(key,JSON.parse(val)),
    delete:async key=>records.delete(key)};
}
const sport=(id,ms,sportType)=>({id:String(id),startedAtMs:ms,
  date:"2026-10-17",sportType,visibility:"everyone",
  distanceMeters:4900,durationSeconds:1900,name:"Sortie du jour"});

test("importe et conserve plusieurs sports personnels sans doublons",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  const activities=[sport(111,1792224000000,"Run"),sport(222,1792228000000,"Kitesurf")];
  const first=await archiveNewSports(env,activities,{maxRoutes:0});
  const second=await archiveNewSports(env,activities,{maxRoutes:0});
  assert.equal(first.imported,2);
  assert.equal(second.imported,0);
  const all=await archiveIndex(env);
  assert.equal(all.length,2);
  assert.deepEqual(new Set(all.map(x=>x.sport)),new Set(["course","kitesurf"]));
  assert.equal((await publicArchives(env)).length,0,"ne publier aucune donnée API par défaut");
});
