import test from "node:test";
import assert from "node:assert/strict";
import {syncPublicRuns,publicChallenge,publicRoute} from "../worker/defi.js";

function bucket(){
  const objects=new Map();
  return {
    objects,
    get:async key=>objects.has(key)?{json:async()=>objects.get(key)}:null,
    put:async(key,text)=>objects.set(key,JSON.parse(text)),
    delete:async key=>objects.delete(key)
  };
}
function activity(id,date,visibility="everyone",distanceMeters=4000){
  return {id:String(id),name:"Course du "+date,startedAtMs:Date.parse(date+"T12:00:00Z"),
    durationSeconds:1500,distanceMeters,visibility};
}
test("les courses Strava privées ne sont jamais dans le flux public, et l'historique persiste",async()=>{
  const original=globalThis.fetch;
  const store=bucket(),env={PHOTOS_PRIVEES:store,VOYAGE_BRIDGE_KEY:"x".repeat(48)};
  store.objects.set("__meta/defi/config.json",{debut:"2026-10-15",chessUsername:"rafaelorset",timezone:"Europe/Paris"});
  let batch=[activity(1,"2026-10-17"),activity(2,"2026-10-17","only_me"),
    activity(3,"2026-10-16")];
  globalThis.fetch=async()=>new Response(JSON.stringify({items:batch}),{
    status:200,headers:{"content-type":"application/json"}
  });
  try{
    const first=await syncPublicRuns(env);
    assert.equal(first.count,2);
    const summary=await publicChallenge(env);
    assert.equal(summary.jours[0].activite.id,"1");
    assert.equal(summary.jours[1].activite.id,"3");
    assert.equal(summary.stats.joursActivites,2);
    assert.equal(summary.coursesRecentes.length,2);
    // Une visite ultérieure ne doit pas effacer une réussite lorsque la course
    // du jour précédent n'est plus dans la liste des dix dernières.
    store.objects.set("__meta/defi/strava-public-poll.json",{at:"2026-10-16T00:00:00Z"});
    batch=[activity(4,"2026-10-17")];
    await syncPublicRuns(env);
    const after=await publicChallenge(env);
    assert.equal(after.jours[0].activite.id,"4");
    assert.equal(after.jours[1].activite.id,"3");
    assert.equal(after.stats.joursActivites,2);
    assert.equal(after.coursesRecentes.length,1);
  }finally{globalThis.fetch=original;}
});
test("le parcours public doit appartenir à une course récemment publiée",async()=>{
  const store=bucket(),env={PHOTOS_PRIVEES:store,VOYAGE_BRIDGE_KEY:"x".repeat(48)};
  assert.equal(await publicRoute(env,"123"),null);
  store.objects.set("__meta/defi/strava-public-recent.json",{items:[{id:"123"}]});
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({
    geoRoute:Array.from({length:30},(_,i)=>[43+i*.0001,5+i*.0001])
  }),{status:200,headers:{"content-type":"application/json"}});
  try{
    const route=await publicRoute(env,"123");
    assert.ok(route.length>2&&route.length<30);
    assert.equal(await publicRoute(env,"999"),null);
  }finally{globalThis.fetch=original;}
});
