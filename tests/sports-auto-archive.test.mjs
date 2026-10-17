import test from "node:test";
import assert from "node:assert/strict";
import {archiveNewSports,decodeSummaryPolyline} from "../worker/archive-auto.js";
import {archiveIndex,publicArchives,publicArchivedRoute,archiveMapPoints,setAutoPublication,autoPublicationEnabled} from "../worker/parcours-archive.js";
import {summarizeChallenge} from "../worker/defi.js";

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

test("le propriétaire peut publier ses dix copies automatiquement même avec visibilité source inconnue",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  const sports=Array.from({length:10},(_,i)=>({
    ...sport(1000+i,1792224000000+i*60000,"Run"),
    visibility:i%2===0?"unknown":"only_me"
  }));
  await archiveNewSports(env,sports,{maxImports:12,maxRoutes:0});
  assert.equal((await archiveIndex(env)).length,10);
  assert.equal(await autoPublicationEnabled(env),true);
  assert.equal((await publicArchives(env)).length,10,
    "la visibilité de l'archive appartient au propriétaire, pas au fournisseur");
  await setAutoPublication(env,false);
  assert.equal((await publicArchives(env)).length,0);
  assert.equal((await archiveIndex(env)).length,10,"désactiver la publication ne supprime jamais R2");
  await setAutoPublication(env,true);
  assert.equal((await publicArchives(env)).length,10);
});
test("un GPX personnel privé reste privé quel que soit le réglage des imports automatiques",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  await env.PHOTOS_PRIVEES.put("__meta/parcours/index.json",JSON.stringify({items:[
    {id:"a",source:"archive",public:false,date:"2026-10-17",fin:1792224000000},
    {id:"b",source:"archive",public:true,date:"2026-10-17",fin:1792224000000},
    {id:"c",source:"import_automatique",public:false,visibility:"unknown",
      publicationBloquee:true,date:"2026-10-17",fin:1792224000000}
  ]}));
  assert.deepEqual((await publicArchives(env)).map(x=>x.id),["b"]);
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
test("une course récupérée automatiquement complète le défi du jour avec les échecs rapides",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  await archiveNewSports(env,[sport(987,1792224000000,"Run")],{maxRoutes:0});
  const activities=await publicArchives(env);
  const config={debut:"2026-10-17",chessUsername:"rafaelorset",timezone:"Europe/Paris"};
  const games=[{date:"2026-10-17",fin:1792240000,mode:"rapid",result:"defaite",rating:1010,url:"https://www.chess.com/game/live/123"}];
  const result=summarizeChallenge(config,{games},activities,"2026-10-17");
  assert.equal(result.stats.joursActivites,1);
  assert.equal(result.stats.joursEchecs,1);
  assert.equal(result.jours[0].resultat,"reussi");
  assert.equal(result.jours[0].activite.km,4.9);
});

test("un tracé résumé est conservé immédiatement dans R2 et zoomable sur la carte",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  const item={...sport(1234,1792224000000,"Run"),
    summaryPolyline:"_p~iF~ps|U_ulLnnqC_mqNvxq\x60@"};
  const decoded=decodeSummaryPolyline(item.summaryPolyline);
  assert.equal(decoded.length,3);
  const result=await archiveNewSports(env,[item],{maxRoutes:0});
  assert.equal(result.imported,1);
  const publicRuns=await publicArchives(env);
  assert.equal(publicRuns.length,1);
  assert.equal(publicRuns[0].parcours,true);
  const route=await publicArchivedRoute(env,publicRuns[0].id);
  assert.deepEqual(route,decoded);
  const markers=await archiveMapPoints(env);
  assert.equal(markers.length,1);
  assert.ok(Number.isFinite(markers[0].latitude));
});
test("une ancienne copie R2 sans GPS est enrichie au passage suivant",async()=>{
  const env={PHOTOS_PRIVEES:fakeBucket()};
  const first=sport(5000,1792224000000,"Run");
  await archiveNewSports(env,[first],{maxRoutes:0});
  assert.equal((await publicArchives(env))[0].parcours,false);
  await archiveNewSports(env,[{
    ...first,summaryPolyline:"_p~iF~ps|U_ulLnnqC_mqNvxq\x60@"
  }],{maxRoutes:0});
  const archives=await publicArchives(env);
  assert.equal(archives.length,1);
  assert.equal(archives[0].parcours,true);
  assert.equal((await archiveMapPoints(env)).length,1);
  assert.ok((await publicArchivedRoute(env,archives[0].id)).length>1);
});
