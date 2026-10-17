import test from "node:test";
import assert from "node:assert/strict";
import {dateInZone,freshPublicChallenge} from "../worker/defi.js";
import {archiveIndex,archiveMapPoints,publicArchivedRoute} from "../worker/parcours-archive.js";

function bucket(){
  const items=new Map();
  return {
    get:async key=>items.has(key)?{json:async()=>items.get(key)}:null,
    put:async(key,value)=>items.set(key,JSON.parse(value)),
    delete:async key=>items.delete(key)
  };
}
function polyline(points){
  let prevLat=0,prevLon=0;
  const component=value=>{
    let num=value<0?~(value<<1):(value<<1),result="";
    while(num>=0x20){result+=String.fromCharCode((0x20|(num&0x1f))+63);num>>=5;}
    return result+String.fromCharCode(num+63);
  };
  return points.map(([lat,lon])=>{
    const la=Math.round(lat*1e5),lo=Math.round(lon*1e5);
    const result=component(la-prevLat)+component(lo-prevLon);
    prevLat=la;prevLon=lo;return result;
  }).join("");
}
test("la page publique archive la sortie et valide le défi au même rafraîchissement",async()=>{
  const original=globalThis.fetch;
  const date=dateInZone(Date.now(),"Europe/Paris");
  const gps=polyline(Array.from({length:24},(_,i)=>[43.17+i*.0001,5.60+i*.0002]));
  const env={PHOTOS_PRIVEES:bucket(),VOYAGE_BRIDGE_KEY:"s".repeat(48)};
  await env.PHOTOS_PRIVEES.put("__meta/defi/config.json",JSON.stringify({
    debut:date,chessUsername:"rafaelorset",timezone:"Europe/Paris"
  }));
  await env.PHOTOS_PRIVEES.put("__meta/defi/chess.json",JSON.stringify({
    lastSync:new Date().toISOString(),
    ratingStats:{rapid:1010},games:[{date,mode:"rapid",rating:1010,
      result:"Défaite",fin:Math.floor(Date.now()/1000),url:"https://www.chess.com/game/live/123"}]
  }));
  let fetches=0;
  globalThis.fetch=async url=>{
    fetches++;
    const str=String(url);
    if(str.endsWith("/api/voyage/strava/activities"))
      return new Response(JSON.stringify({items:[{
        id:"5551234",startedAtMs:Date.now()-30000,durationSeconds:900,
        sportType:"Run",name:"Course test",visibility:"everyone",
        distanceMeters:2700,summaryPolyline:gps
      }]}),{status:200,headers:{"content-type":"application/json"}});
    return new Response("not found",{status:404});
  };
  try{
    const first=await freshPublicChallenge(env);
    assert.equal(first.stats.joursEchecs,1);
    assert.equal(first.stats.joursActivites,1);
    assert.equal(first.stats.joursComplets,1);
    assert.equal(first.jours[0].resultat,"reussi");
    assert.equal(first.jours[0].activite.titre,"Course test");
    assert.equal(first.coursesRecentes.length,1);
    assert.equal(first.coursesRecentes[0].parcours,true);
    const stored=await archiveIndex(env);
    assert.equal(stored.length,1);
    assert.equal(stored[0].sourceId,"strava:5551234");
    const route=await publicArchivedRoute(env,stored[0].id);
    assert.ok(route.length>=2);
    const positions=await archiveMapPoints(env);
    assert.equal(positions.length,1);
    assert.equal(positions[0].titre,"Course test");
    const second=await freshPublicChallenge(env);
    assert.equal(second.stats.joursComplets,1);
    assert.equal((await archiveIndex(env)).length,1);
    assert.equal(fetches,1,"la seconde ouverture utilise le cache sans appel redondant");
  }finally{globalThis.fetch=original;}
});

test("le bouton Actualiser importe une deuxième course sans attendre le rafraîchissement normal",async()=>{
  const original=globalThis.fetch;
  const date=dateInZone(Date.now(),"Europe/Paris");
  const env={PHOTOS_PRIVEES:bucket(),VOYAGE_BRIDGE_KEY:"z".repeat(50)};
  await env.PHOTOS_PRIVEES.put("__meta/defi/config.json",JSON.stringify({
    debut:date,chessUsername:"rafaelorset",timezone:"Europe/Paris"
  }));
  await env.PHOTOS_PRIVEES.put("__meta/defi/chess.json",JSON.stringify({
    lastSync:new Date().toISOString(),games:[],ratingStats:{rapid:1000}
  }));
  const mk=(id,seconds)=>({
    id:String(id),startedAtMs:Date.now()-seconds*1000,durationSeconds:900,
    sportType:"Run",name:"Activité "+id,visibility:"everyone",
    distanceMeters:2600
  });
  let count=0;
  globalThis.fetch=async url=>{
    if(!String(url).endsWith("/api/voyage/strava/activities"))
      return new Response("",{status:404});
    count++;
    return new Response(JSON.stringify({items:count===1?[mk(100,90)]:
      [mk(200,30),mk(100,90)]}),{status:200});
  };
  try{
    let data=await freshPublicChallenge(env);
    assert.equal(data.coursesRecentes.length,1);
    await env.PHOTOS_PRIVEES.put("__meta/defi/activites-sportives-api-poll.json",
      JSON.stringify({at:new Date(Date.now()-40000).toISOString()}));
    data=await freshPublicChallenge(env,{forceSports:true});
    assert.equal(data.coursesRecentes.length,2);
    assert.equal((await archiveIndex(env)).length,2);
    assert.equal(count,2);
    assert.equal(data.stats.joursActivites,1,
      "deux courses le même jour ne comptent que pour un objectif");
  }finally{globalThis.fetch=original;}
});
