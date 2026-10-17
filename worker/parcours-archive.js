// Archives GPS indépendantes des fournisseurs externes.
// Une archive est créée à partir d'un fichier GPX chargé directement par le propriétaire.
import { getJSON, putJSON, validDate } from "./content.js";

const INDEX="__meta/parcours/index.json";
const PREFIX="__meta/parcours/archive/";
const SOURCE="__meta/parcours/originaux/";
const MAX_BYTES=5*1024*1024;
const MAX_POINTS=50000;
const MAX_STORED_POINTS=1500;
const rad=Math.PI/180;

function haversine(a,b){
  const dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad;
  const v=Math.sin(dLat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(v)));
}
function sample(points,max=MAX_STORED_POINTS){
  if(points.length<=max)return points;
  const result=[];
  for(let i=0;i<max;i++)result.push(points[Math.round(i*(points.length-1)/(max-1))]);
  return result;
}
function escapeAttr(attrs,key){
  const match=new RegExp("\\b"+key+"\\s*=\\s*(['\"])([-+0-9.]+)\\1","i").exec(attrs);
  return match?Number(match[2]):NaN;
}
export function parseGpx(source){
  if(typeof source!=="string"||!source.includes("<gpx")||source.length>MAX_BYTES)return null;
  const pattern=/<(?:\w+:)?trkpt\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?trkpt\s*>)/gi;
  const points=[];let length=0,start=null,end=null,previous=null;
  for(const match of source.matchAll(pattern)){
    const lat=escapeAttr(match[1],"lat"),lon=escapeAttr(match[1],"lon");
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)continue;
    const point=[lat,lon];
    if(previous){
      const d=haversine(previous,point);
      // Exclure les erreurs de GPS qui créent une téléportation.
      if(d<2)length+=d;
    }
    previous=point;
    const moment=/<(?:\w+:)?time\s*>\s*([^<]{12,45})\s*<\/(?:\w+:)?time\s*>/i.exec(match[2]||"")?.[1];
    const time=moment?Date.parse(moment):NaN;
    if(Number.isFinite(time)){if(start===null)start=time;end=time;}
    points.push(point);
    if(points.length>MAX_POINTS)return null;
  }
  if(points.length<2)return null;
  return {route:sample(points),distanceKm:Math.round(length*100)/100,
    start,end,pointCount:points.length};
}
function publicItem(item){
  return {id:item.id,date:item.date,fin:item.fin,km:item.km,
    minutes:item.minutes,titre:item.titre,url:"/defi/#courses",source:"archive"};
}
export async function archiveIndex(env){
  const value=await getJSON(env.PHOTOS_PRIVEES,INDEX,{items:[]});
  return Array.isArray(value?.items)?value.items:[];
}
export async function publicArchives(env){
  const items=await archiveIndex(env);
  return items.filter(x=>x.public===true).sort((a,b)=>b.fin-a.fin).map(publicItem);
}
export async function importGpx(env,form){
  const file=form?.get("fichier");
  const title=String(form?.get("titre")||"Course à pied").trim().slice(0,120);
  const date=String(form?.get("date")||"");
  const visibility=String(form?.get("visibilite")||"prive");
  if(!file||typeof file.text!=="function"||file.size>MAX_BYTES||file.size===0)
    throw Error("Choisis un fichier GPX de 5 Mo maximum.");
  if(!title||!validDate(date)||!["public","prive"].includes(visibility))
    throw Error("Renseigne un titre, une date et la visibilité.");
  const xml=await file.text();
  const parsed=parseGpx(xml);
  if(!parsed)throw Error("Impossible de lire ce tracé GPX.");
  const dateTime=parsed.start??Date.parse(date+"T12:00:00Z");
  if(!Number.isFinite(dateTime))throw Error("Date invalide.");
  const id=crypto.randomUUID();
  const item={id,date,fin:dateTime,km:parsed.distanceKm,
    minutes:parsed.start!==null&&parsed.end!==null&&parsed.end>parsed.start
      ?Math.round((parsed.end-parsed.start)/60000):null,
    titre: title, public:visibility==="public",pointCount:parsed.pointCount,
    source:"archive",ajouteLe:new Date().toISOString()};
  // La copie GPX originale appartient au propriétaire et ne dépend pas de l'API.
  await env.PHOTOS_PRIVEES.put(SOURCE+id+".gpx",xml,{
    httpMetadata:{contentType:"application/gpx+xml"}});
  await putJSON(env.PHOTOS_PRIVEES,PREFIX+id+".json",{...item,route:parsed.route});
  const existing=await archiveIndex(env);
  await putJSON(env.PHOTOS_PRIVEES,INDEX,{items:[...existing,item].slice(-6000)});
  return publicItem(item);
}
export async function publicArchivedRoute(env,id){
  if(!/^[a-f0-9-]{36}$/.test(id))return null;
  const items=await archiveIndex(env);
  if(!items.some(item=>item.id===id&&item.public===true))return null;
  const record=await getJSON(env.PHOTOS_PRIVEES,PREFIX+id+".json",null);
  if(!record?.route||!Array.isArray(record.route))return null;
  // Les premières et dernières portions ne sont jamais livrées au navigateur public.
  const points=record.route;
  const cut=points.length>=20?Math.ceil(points.length*.07):0;
  return points.slice(cut,points.length-cut);
}
export async function archiveMapPoints(env){
  const items=await archiveIndex(env);
  const marked=items.filter(item=>item.public===true).sort((a,b)=>b.fin-a.fin).slice(0,100);
  const records=await Promise.all(marked.map(item=>getJSON(env.PHOTOS_PRIVEES,PREFIX+item.id+".json",null)));
  return marked.flatMap((item,i)=>{
    const pts=records[i]?.route||[];
    if(pts.length<2)return [];
    const position=pts[Math.floor(pts.length/2)];
    if(!Array.isArray(position)||position.length!==2)return [];
    return [{id:item.id,type:"course",date:item.date,fin:item.fin,
      titre:item.titre,latitude:position[0],longitude:position[1],
      distance:item.km}];
  });
}
