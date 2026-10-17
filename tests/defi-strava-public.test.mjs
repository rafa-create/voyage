import test from "node:test";
import assert from "node:assert/strict";
import {syncPublicRuns,publicChallenge,publicRoute} from "../worker/defi.js";
import {parseGpx,importGpx,publicArchives,publicArchivedRoute} from "../worker/parcours-archive.js";

function bucket(){
  const records=new Map();
  return {
    records,
    get:async key=>records.has(key)?{json:async()=>records.get(key)}:null,
    put:async(key,value)=>records.set(key,key.endsWith(".gpx")?value:JSON.parse(value)),
    delete:async key=>records.delete(key)
  };
}
function fakeGpx(date="2026-10-17"){
  const pts=Array.from({length:30},(_,i)=>{
    const lat=(43.2+i*.0001).toFixed(6),lon=(5.5+i*.0001).toFixed(6);
    const time=new Date(Date.parse(date+"T09:00:00Z")+i*60000).toISOString();
    return '<trkpt lat="'+lat+'" lon="'+lon+'"><time>'+time+'</time></trkpt>';
  }).join("");
  return '<gpx><trk><trkseg>'+pts+'</trkseg></trk></gpx>';
}
function form(date,visibilite){
  const xml=fakeGpx(date);
  const values={fichier:{size:xml.length,text:async()=>xml},
    titre:"Course du matin",date,visibilite};
  return {get:key=>values[key]||null};
}
test("le GPX vérifié peut être archivé sans passer par l'API Strava",async()=>{
  const points=parseGpx(fakeGpx());
  assert.equal(points.pointCount,30);
  assert.ok(points.distanceKm>0);
  assert.equal((await syncPublicRuns({})).etat,"non_configure");
});
test("seules les archives expressément publiées apparaissent au public",async()=>{
  const env={PHOTOS_PRIVEES:bucket()};
  env.PHOTOS_PRIVEES.records.set("__meta/defi/config.json",{
    debut:"2026-10-15",chessUsername:"rafaelorset",timezone:"Europe/Paris"
  });
  const publicRun=await importGpx(env,form("2026-10-17","public"));
  const privateRun=await importGpx(env,form("2026-10-16","prive"));
  const visible=await publicArchives(env);
  assert.equal(visible.length,1);
  assert.equal(visible[0].id,publicRun.id);
  assert.ok((await publicArchivedRoute(env,publicRun.id)).length<30);
  assert.equal(await publicArchivedRoute(env,privateRun.id),null);
  assert.equal(await publicRoute(env,privateRun.id),null);
  const summary=await publicChallenge(env);
  assert.equal(summary.jours[0].activite.id,publicRun.id);
  assert.equal(summary.jours[1].activite,null);
  assert.equal(summary.stats.joursActivites,1);
});
