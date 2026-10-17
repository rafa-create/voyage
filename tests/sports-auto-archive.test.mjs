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
  assert.equal((await publicArchives(env)).length,2,"les activités déjà publiques peuvent être montrées dans le journal");
});

test("jamais d'activité réservée aux abonnés ou privée dans la page publique",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  const everyone={...sport(555,1792224000000,"Run"),visibility:"everyone"};
  const onlyMe={...sport(556,1792228000000,"Kitesurf"),visibility:"only_me"};
  const followers={...sport(557,1792230000000,"Run"),visibility:"followers_only"};
  const unknown={...sport(558,1792232000000,"Run"),visibility:"unknown"};
  await archiveNewSports(env,[everyone,onlyMe,followers,unknown],{maxRoutes:0});
  assert.equal((await archiveIndex(env)).length,4);
  assert.deepEqual((await publicArchives(env)).map(x=>x.titre),["Sortie du jour"]);
  assert.equal((await publicArchives(env))[0].date,"2026-10-17");
});
test("les anciennes copies publiques remontent automatiquement dans le défi",async()=>{
  const bucket=fakeBucket();
  const env={PHOTOS_PRIVEES:bucket};
  await archiveNewSports(env,[sport(789,1792224000000,"Run")],{maxRoutes:0});
  const list=await archiveIndex(env);
  list[0].public=false;
  await bucket.put("__meta/parcours/index.json",JSON.stringify({items:list}));
  assert.equal((await publicArchives(env)).length,1);
});