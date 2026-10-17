// Cache privé à courte durée de vie de l'API sportive.
// Ne pas ajouter ces données à l'archive GPX permanente ni aux réponses publiques.
// Le contrat du fournisseur impose au plus 7 jours de rétention côté API.
import {getJSON,putJSON} from "./content.js";
import {privateStravaFetch} from "./strava-bridge.js";

const STORE="__meta/defi/activites-sportives-api-cache.json";
const POLL="__meta/defi/activites-sportives-api-poll.json";
const EXPIRE_MS=7*24*60*60*1000;
const POLL_MS=10*60*1000;
const sports={
  Run:"course",TrailRun:"course",VirtualRun:"course",
  Ride:"velo",MountainBikeRide:"velo",GravelRide:"velo",EBikeRide:"velo",
  Kitesurf:"kitesurf",Soccer:"football",Football:"football",
  Walk:"marche",Hike:"marche",Swim:"natation"
};
function normalized(item){
  const id=String(item?.id||"");
  const startedAtMs=Number(item?.startedAtMs);
  if(!/^[1-9][0-9]{0,19}$/.test(id)||!Number.isFinite(startedAtMs)||
    startedAtMs<946684800000||startedAtMs>Date.now()+300000)return null;
  // Les versions antérieures de la passerelle ne renvoyaient que des courses
  // sans le champ sportType.
  const sportType=String(item.sportType||"Run").slice(0,36);
  const distanceMeters=item?.distanceMeters==null?null:Number(item.distanceMeters);
  return {
    id,startedAtMs,date:new Intl.DateTimeFormat("fr-FR",{
      timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(new Date(startedAtMs)).reduce((r,p)=>({...r,[p.type]:p.value}),{}),
    sportType,sport:sports[sportType]||"autre",
    name:String(item.name||"Activité physique").slice(0,100),
    distanceMeters:distanceMeters!==null&&Number.isFinite(distanceMeters)&&distanceMeters>=0?distanceMeters:null,
    durationSeconds:Number.isFinite(item.durationSeconds)?Math.round(item.durationSeconds):null,
    visibility:item.visibility||"unknown"
  };
}
function publicDate({date,...item}){
  const value=date&&date.year&&date.month&&date.day
    ?date.year+"-"+date.month+"-"+date.day:"";
  return {...item,date:value};
}
function isFresh(snapshot){
  const stamp=Date.parse(snapshot?.syncedAt||"");
  return Number.isFinite(stamp)&&Date.now()-stamp>=0&&Date.now()-stamp<EXPIRE_MS;
}
export async function getCachedSports(env){
  if(!env.PHOTOS_PRIVEES)return {connected:false,items:[],syncedAt:null};
  const snapshot=await getJSON(env.PHOTOS_PRIVEES,STORE,null);
  if(!isFresh(snapshot)){
    if(snapshot)await env.PHOTOS_PRIVEES.delete(STORE);
    return {connected:false,items:[],syncedAt:null};
  }
  // Ne conserver que les activités récentes : pas de journal API à long terme.
  const cutoff=Date.now()-EXPIRE_MS;
  const items=Array.isArray(snapshot.items)?snapshot.items.filter(x=>x.startedAtMs>=cutoff):[];
  return {connected:true,items,syncedAt:snapshot.syncedAt};
}
export async function syncRecentSports(env,{force=false}={}){
  if(!env.PHOTOS_PRIVEES||!env.VOYAGE_BRIDGE_KEY)return {etat:"non_configure",items:[]};
  const now=Date.now();
  const last=await getJSON(env.PHOTOS_PRIVEES,POLL,null);
  const elapsed=now-Date.parse(last?.at||"");
  if(!force&&elapsed>=0&&elapsed<POLL_MS){
    const cached=await getCachedSports(env);
    return {etat:"cache",items:cached.items,lastSync:cached.syncedAt};
  }
  await putJSON(env.PHOTOS_PRIVEES,POLL,{at:new Date(now).toISOString()});
  const response=await privateStravaFetch(env,"activities");
  if(response.status!==200){
    const cached=await getCachedSports(env);
    return {etat:"erreur",items:cached.items,lastSync:cached.syncedAt,
      reason:response.body?.error||"Récupération des activités impossible."};
  }
  const cutoff=now-EXPIRE_MS;
  const items=(Array.isArray(response.body?.items)?response.body.items:[])
    .map(normalized).filter(x=>x&&x.startedAtMs>=cutoff)
    .map(publicDate)
    .sort((a,b)=>b.startedAtMs-a.startedAtMs).slice(0,100);
  const syncedAt=new Date().toISOString();
  await putJSON(env.PHOTOS_PRIVEES,STORE,{items,syncedAt});
  // Enregistrer une copie PERSONNELLE dans R2, y compris lorsqu'aucun
  // parcours GPS n'est disponible. Chaque activité est dédupliquée par ID.
  // La passerelle n'envoie pas les fichiers originaux de la montre.
  let archive={imported:0,routes:0};
  try{
    const {archiveNewSports}=await import("./archive-auto.js");
    archive=await archiveNewSports(env,items,{maxRoutes:3});
  }catch(e){archive={imported:0,routes:0,error:String(e)};}
  return {etat:"actualise",items,lastSync:syncedAt,archive};
}
