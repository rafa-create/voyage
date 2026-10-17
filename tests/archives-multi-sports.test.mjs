import test from "node:test";
import assert from "node:assert/strict";
import {importGpx,publicArchives,archiveMapPoints} from "../worker/parcours-archive.js";
import {summarizeChallenge} from "../worker/defi.js";

const bucket=()=>{
  const state=new Map();
  return {
    get:async key=>state.has(key)?{json:async()=>state.get(key)}:null,
    put:async(key,value)=>{
      state.set(key,key.endsWith(".gpx")?value:JSON.parse(value));
    }
  };
};
function sampleGpx(hour=9){
  const pts=Array.from({length:20},(_,i)=>
    '<trkpt lat="'+(43.15+i*.0002).toFixed(6)+'" lon="'+(5.60+i*.0001).toFixed(6)+'"><time>'+
    new Date(Date.UTC(2026,9,17,hour,i,0)).toISOString()+'</time></trkpt>');
  return '<gpx><trk><name>Sport enregistré</name><trkseg>'+pts.join("")+'</trkseg></trk></gpx>';
}
function form(xml,sport,name){
  const input={
    fichier:{size:xml.length,name:name+".gpx",text:async()=>xml},
    titre:"",date:"",visibilite:"public",sport
  };
  return {get:key=>input[key]??null};
}
test("deux sports dans la journée sont conservés dans l'archive et la carte",async()=>{
  const env={PHOTOS_PRIVEES:bucket()};
  const first=await importGpx(env,form(sampleGpx(9),"course","Matin"));
  const later=await importGpx(env,form(sampleGpx(18),"kitesurf","Soir"));
  const list=await publicArchives(env);
  assert.equal(list.length,2);
  assert.equal(list[0].id,later.id);
  assert.equal(list[1].id,first.id);
  const markers=await archiveMapPoints(env);
  assert.equal(markers.length,2);
  assert.deepEqual(markers.map(x=>x.sport),["kitesurf","course"]);
  const challenge=summarizeChallenge({
    debut:"2026-10-17",chessUsername:"rafaelorset",timezone:"Europe/Paris"
  },{games:[]},list,"2026-10-17");
  assert.equal(challenge.stats.joursActivites,1);
  assert.equal(challenge.jours[0].activite.id,later.id);
});
test("le même fichier GPX ne produit aucun doublon",async()=>{
  const env={PHOTOS_PRIVEES:bucket()};
  const xml=sampleGpx();
  const first=await importGpx(env,form(xml,"course","Matin"));
  const next=await importGpx(env,form(xml,"course","Matin"));
  assert.equal(next.id,first.id);
  assert.equal(next.alreadyArchived,true);
  assert.equal((await publicArchives(env)).length,1);
});
