// Archives GPS indépendantes des fournisseurs externes.
// Une archive est créée à partir d'un fichier GPX chargé directement par le propriétaire.
import { getJSON, putJSON, validDate } from "./content.js";

const INDEX="__meta/parcours/index.json";
const PREFIX="__meta/parcours/archive/";
const SOURCE="__meta/parcours/originaux/";
const POLICY_KEY="__meta/parcours/publication-auto.json";
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
  return {route:sample(points,500),routeDetail:sample(points,5000),routeFull:points,
    distanceKm:Math.round(length*100)/100,start,end,pointCount:points.length};
}
function publicItem(item){
  const parcours=item.source!=="import_automatique"||["disponible","resume"].includes(item.routeState);
  const distant=item.source==="import_automatique"&&/^strava:[1-9][0-9]{0,19}$/.test(item.sourceId||"")
    ? "https://www.strava.com/activities/"+item.sourceId.slice(7):null;
  return {id:item.id,date:item.date,fin:item.fin,km:item.km,
    minutes:item.minutes,titre:item.titre,sport:item.sport||"course",
    parcours,url:distant||item.url||null,source:"archive"};
}
export async function archiveIndex(env){
  const value=await getJSON(env.PHOTOS_PRIVEES,INDEX,{items:[]});
  return Array.isArray(value?.items)?value.items:[];
}
// Le propriétaire du carnet demande expressément un journal et des cartes
// publics sans connexion. Ce choix appartient au carnet : la visibilité au
// sein de la plateforme d'origine ne commande pas celle de son archive.
// Une bascule admin permet néanmoins de masquer les imports automatiques
// instantanément, sans supprimer aucun fichier de R2.
export async function autoPublicationEnabled(env){
  const settings=await getJSON(env.PHOTOS_PRIVEES,POLICY_KEY,null);
  return settings?.enabled!==false;
}
export async function setAutoPublication(env,enabled){
  if(typeof enabled!=="boolean")throw Error("Valeur de publication invalide.");
  await putJSON(env.PHOTOS_PRIVEES,POLICY_KEY,{
    enabled,modifieLe:new Date().toISOString()
  });
  return {enabled};
}
export function isPublishedActivity(item,automaticEnabled=true){
  if(!item||item.publicationBloquee===true)return false;
  if(item.source==="import_automatique")return automaticEnabled;
  return item.public===true;
}
export async function publicArchives(env){
  const [items,enabled]=await Promise.all([archiveIndex(env),autoPublicationEnabled(env)]);
  return items.filter(item=>isPublishedActivity(item,enabled))
    .sort((a,b)=>b.fin-a.fin).map(publicItem);
}
export async function importGpx(env,form){
  const file=form?.get("fichier");
  const name=String(form?.get("titre")||"").trim().slice(0,120);
  const givenDate=String(form?.get("date")||"");
  const visibility=String(form?.get("visibilite")||"prive");
  const sport=String(form?.get("sport")||"course");
  if(!file||typeof file.text!=="function"||file.size>MAX_BYTES||file.size===0)
    throw Error("Choisis un fichier GPX de 5 Mo maximum.");
  if(!["public","prive"].includes(visibility)||
    !["course","kitesurf","football","velo","marche","autre"].includes(sport))
    throw Error("Type d'activité ou visibilité invalide.");
  const xml=await file.text();
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(xml));
  const sourceHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
  const duplicates=await archiveIndex(env);
  const already=duplicates.find(item=>item.sourceHash===sourceHash);
  if(already)return {...publicItem(already),alreadyArchived:true};
  const parsed=parseGpx(xml);
  if(!parsed)throw Error("Impossible de lire ce tracé GPX.");
  // L'heure de départ contenue dans l'original est prioritaire.
  const date=parsed.start!==null?(()=>{
    const parts=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",
      year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(parsed.start));
    const read=(key)=>parts.find(p=>p.type===key)?.value||"";
    return read("year")+"-"+read("month")+"-"+read("day");
  })():givenDate;
  if(!validDate(date))throw Error("Le GPX ne contient pas d'heure de départ : renseigne une date manuellement.");
  const trackName=/<(?:\w+:)?name[^>]*>([^<]{1,120})<\/(?:\w+:)?name>/i.exec(xml)?.[1]||"";
  const baseName=typeof file.name==="string"?file.name.replace(/\.gpx$/i,"").replace(/[_-]+/g," "):"";
  const title=(name||trackName||baseName||"Activité sportive").trim().slice(0,120);
  const dateTime=parsed.start??Date.parse(date+"T12:00:00Z");
  if(!Number.isFinite(dateTime))throw Error("Date invalide.");
  const id=crypto.randomUUID();
  const item={id,date,fin:dateTime,km:parsed.distanceKm,
    minutes:parsed.start!==null&&parsed.end!==null&&parsed.end>parsed.start
      ?Math.round((parsed.end-parsed.start)/60000):null,
    titre: title,sport, public:visibility==="public",pointCount:parsed.pointCount,
    latitude:parsed.routeFull[Math.floor(parsed.routeFull.length/2)][0],
    longitude:parsed.routeFull[Math.floor(parsed.routeFull.length/2)][1],
    source:"archive",sourceHash,ajouteLe:new Date().toISOString()};
  // La copie GPX originale appartient au propriétaire et ne dépend pas de l'API.
  await env.PHOTOS_PRIVEES.put(SOURCE+id+".gpx",xml,{
    httpMetadata:{contentType:"application/gpx+xml"}});
  await putJSON(env.PHOTOS_PRIVEES,PREFIX+id+".json",{...item,
    route:parsed.route,routeDetail:parsed.routeDetail,routeFull:parsed.routeFull});
  await putJSON(env.PHOTOS_PRIVEES,INDEX,{items:[...duplicates,item]});
  return publicItem(item);
}
export async function publicArchivedRoute(env,id,precision="overview"){
  if(!/^[a-f0-9-]{36}$/.test(id))return null;
  const [items,enabled]=await Promise.all([archiveIndex(env),autoPublicationEnabled(env)]);
  if(!items.some(item=>item.id===id&&isPublishedActivity(item,enabled)))return null;
  const record=await getJSON(env.PHOTOS_PRIVEES,PREFIX+id+".json",null);
  const requested=precision==="full"?"routeFull":precision==="detail"?"routeDetail":"route";
  // Les anciennes archives n'ont que leur tracé simplifié : elles restent lisibles.
  const points=Array.isArray(record?.[requested])?record[requested]:record?.route;
  if(!Array.isArray(points)||points.length<2)return null;
  // Les premières et dernières portions ne sont jamais livrées au navigateur public.
  const cut=points.length>=20?Math.ceil(points.length*.07):0;
  return points.slice(cut,points.length-cut);
}
export async function archiveMapPoints(env){
  const [items,enabled]=await Promise.all([archiveIndex(env),autoPublicationEnabled(env)]);
  return items.filter(item=>isPublishedActivity(item,enabled)&&Number.isFinite(item.latitude)&&
    Number.isFinite(item.longitude)).sort((a,b)=>b.fin-a.fin).slice(0,1500)
    .map(item=>({id:item.id,type:"course",date:item.date,fin:item.fin,
      titre:item.titre,sport:item.sport||"course",latitude:item.latitude,longitude:item.longitude,
      km:item.km,minutes:item.minutes,parcours:item.source!=="import_automatique"||
        ["resume","disponible"].includes(item.routeState)}));
}
