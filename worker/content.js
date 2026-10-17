import etapesInitiales from "../src/data/etapes.json";
import * as exifr from "exifr";

export const types = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp", avif:"image/avif", gif:"image/gif" };
export const slugOk = value => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length < 90;
export const imageKey = key => Boolean(key && key.length < 700 && !key.split("/").some(x=>!x||x==="."||x==="..") && /\.(?:jpe?g|png|webp|avif|gif)$/i.test(key));
export const validDate = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x+"T12:00:00Z")) && new Date(x+"T12:00:00Z").toISOString().slice(0,10) === x;
export const photoPath = (key, visibilite) => (visibilite==="prive"?"/media-prive/":"/media/") + key;
export async function getJSON(bucket,key,fallback) {
  if (!bucket) return fallback;
  const file=await bucket.get(key);
  if (!file) return fallback;
  try {return await file.json();}catch{return fallback;}
}
export async function putJSON(bucket,key,data){
  await bucket.put(key,JSON.stringify(data),{httpMetadata:{contentType:"application/json"}});
}
export async function listAll(bucket,prefix="",limit=5000){
  if(!bucket)return [];
  const items=[];let cursor;
  do{
    const page=await bucket.list({prefix,limit:Math.min(1000,limit-items.length),cursor,include:["customMetadata"]});
    items.push(...page.objects);
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor&&items.length<limit);
  return items;
}
export async function steps(env){
  const extras=await listAll(env.PHOTOS_PRIVEES,"__meta/etapes/",250);
  const files=await Promise.all(extras.filter(x=>x.key.endsWith(".json")).map(x=>getJSON(env.PHOTOS_PRIVEES,x.key,null)));
  const map=new Map(etapesInitiales.map(x=>[x.slug,{...x}]));
  for(const x of files){if(x&&slugOk(x.slug))map.set(x.slug,{...x,photos:[],videos:[]});}
  const setting=await getJSON(env.PHOTOS_PRIVEES,"__meta/config.json",{actuelle:"la-ciotat"});
  return [...map.values()].map(x=>({...x,statut:x.slug===setting.actuelle?"actuelle":(x.statut==="future"?"future":"passee")})).sort((a,b)=>a.date.localeCompare(b.date));
}
export function matchStep(date,all){
  if(!validDate(date))return null;
  const candidates=all.filter(e=>validDate(e.date)&&date>=e.date&&(e.dateFin ? validDate(e.dateFin)&&date<=e.dateFin : true));
  const sorted=[...all].filter(e=>validDate(e.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const eligible=candidates.filter(e=>{
    if(e.dateFin)return true;
    const next=sorted.find(x=>x.date>e.date);
    return !next||date<next.date;
  });
  return eligible.length===1?eligible[0]:null;
}
export function legacyPhotos(){
  const list=[];
  for(const e of etapesInitiales)for(const p of (e.photos||[])){
    const key=p.src?.startsWith("/media/")?p.src.slice(7):null;
    if(key&&imageKey(key))list.push({key,etape:e.slug,alt:p.alt,legende:p.legende,legacy:true});
  }
  return list;
}
function infoObject(obj,visibilite,stage,alt,legende,legacy=false){
  return {key:obj.key,src:photoPath(obj.key,visibilite),visibilite,etape:stage||null,
    datePrise:obj.customMetadata?.datePrise||null,
    alt:obj.customMetadata?.alt||alt||"Photo de voyage",
    legende:obj.customMetadata?.legende||legende||"",
    ajouteLe:obj.uploaded?.toISOString()||null,legacy};
}
export async function listedPhotos(env,visibility="public"){
  const bucket=visibility==="public"?env.PHOTOS_PUBLIQUES:env.PHOTOS_PRIVEES;
  const objects=await listAll(bucket,"",5200);
  const legacy=new Map(visibility==="public"?legacyPhotos().map(x=>[x.key,x]):[]);
  return objects.filter(x=>imageKey(x.key)).map(x=>{
    const fromLegacy=legacy.get(x.key);
    const step=x.key.startsWith("etapes/")?x.key.split("/")[1]:fromLegacy?.etape||null;
    return infoObject(x,visibility,step,fromLegacy?.alt,fromLegacy?.legende,Boolean(fromLegacy));
  });
}
export function urlYoutube(url){
  try{
    const u=new URL(url);
    if(u.protocol!=="https:")return null;
    let id=null;
    if(["youtu.be","www.youtu.be"].includes(u.hostname))id=u.pathname.split("/")[1];
    if(["www.youtube.com","youtube.com","m.youtube.com","www.youtube-nocookie.com"].includes(u.hostname)){
      id=u.pathname==="/watch"?u.searchParams.get("v"):["embed","shorts","live"].includes(u.pathname.split("/")[1])?u.pathname.split("/")[2]:null;
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id||"")?id:null;
  }catch{return null;}
}
export async function videos(env,slug){
  const db=await getJSON(env.PHOTOS_PRIVEES,"__meta/videos/"+slug+".json",[]);
  const stored=Array.isArray(db)?db:[];
  const step=etapesInitiales.find(x=>x.slug===slug);
  return [...(step?.videos||[]),...stored].filter(v=>urlYoutube(v.url)).map(v=>({id:v.id||null,url:v.url,titre:v.titre||"Vidéo du voyage"}));
}
export async function getCaptureDate(bucket,key){
  // Lire seulement l'en-tête pour l'EXIF, jamais la date de téléversement.
  try{
    const f=await bucket.get(key,{range:{offset:0,length:262144}});
    if(!f)return null;
    const buffer=await f.arrayBuffer();
    const info=await exifr.parse(buffer,["DateTimeOriginal","CreateDate","DateTimeDigitized"]);
    const value=info?.DateTimeOriginal||info?.CreateDate||info?.DateTimeDigitized;
    if(value instanceof Date&&!Number.isNaN(value.getTime())){
      // Exif sans fuseau : retrouver la date civile, ne pas attribuer à uploaded.
      return value.getFullYear()+"-"+String(value.getMonth()+1).padStart(2,"0")+"-"+String(value.getDate()).padStart(2,"0");
    }
    if(typeof value==="string"){
      const m=/^(\d{4})[:\-](\d{2})[:\-](\d{2})/.exec(value);
      if(m){const d=m[1]+"-"+m[2]+"-"+m[3];return validDate(d)?d:null;}
    }
  }catch{}
  return null;
}
export async function movePhoto(from,to,oldKey,newKey,overrides={}){
  const file=await from.get(oldKey);
  if(!file)throw Error("Photo introuvable.");
  const original=file.customMetadata||{};
  await to.put(newKey,file.body,{
    httpMetadata:file.httpMetadata,
    customMetadata:{...original,...overrides},
  });
  await from.delete(oldKey);
}
