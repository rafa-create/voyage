// Cache privé à courte durée de vie de l'API sportive.
// Ne pas ajouter ces données à l'archive GPX permanente ni aux réponses publiques.
// Le contrat du fournisseur impose au plus 7 jours de rétention côté API.
import {getJSON,putJSON} from "./content.js";
import {privateStravaFetch} from "./strava-bridge.js";

const STORE="__meta/defi/activites-sportives-api-cache.json";
const POLL="__meta/defi/activites-sportives-api-poll.json";
const BACKFILL_CURSOR="__meta/defi/activites-sportives-api-backfill.json";
const BACKFILL_DAYS=90;
const MAX_PAGE=10;
const EXPIRE_MS=7*24*60*60*1000;
const POLL_MS=2*60*1000;
const FORCE_POLL_MS=30000;
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
    visibility:item.visibility||"unknown",
    summaryPolyline:typeof item.summaryPolyline==="string"&&item.summaryPolyline.length<=16000
      ?item.summaryPolyline:null
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
  if(elapsed>=0&&elapsed<(force?FORCE_POLL_MS:POLL_MS)){
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
  // Le cache courant ne garde que sept jours, mais l'import des archives
  // personnelles rattrape les activités des 90 derniers jours.
  // Les deux horizons sont distincts.
  const latest=(Array.isArray(response.body?.items)?response.body.items:[])
    .map(normalized).filter(Boolean).map(publicDate)
    .sort((a,b)=>b.startedAtMs-a.startedAtMs);
  const cutoff=now-EXPIRE_MS;
  const backfillCutoff=now-BACKFILL_DAYS*86400000;
  const items=latest.filter(x=>x.startedAtMs>=cutoff);
  const syncedAt=new Date().toISOString();
  await putJSON(env.PHOTOS_PRIVEES,STORE,{items,syncedAt});
  let archive={imported:0,routes:0};
  let backfill={page:1,olderItems:0,status:"aucune_pagination"};
  try{
    const {archiveNewSports}=await import("./archive-auto.js");
    // Par passage, archiver au maximum huit nouveautés de la page récente.
    // Les appels suivants continuent le rattrapage sans doublons.
    archive=await archiveNewSports(env,latest.filter(x=>x.startedAtMs>=backfillCutoff),
      {maxImports:8,maxRoutes:2});
    if(latest.length===100){
      const progress=await getJSON(env.PHOTOS_PRIVEES,BACKFILL_CURSOR,{nextPage:2});
      const page=Math.max(2,Math.min(MAX_PAGE,Number(progress?.nextPage)||2));
      const older=await privateStravaFetch(env,"activities?page="+page);
      if(older.status===200){
        const results=(older.body?.items||[]).map(normalized).filter(Boolean)
          .map(publicDate).filter(x=>x.startedAtMs>=backfillCutoff);
        if(results.length){
          const olderArchive=await archiveNewSports(env,results,
            {maxImports:8,maxRoutes:0});
          archive.imported+=olderArchive.imported||0;
          backfill={page,olderItems:results.length,status:"rattrapage"};
        }else backfill={page,olderItems:0,status:"aucune_activite_recente"};
        const nextPage=older.body.items.length<100||page>=MAX_PAGE||!results.length
          ?2:page+1;
        await putJSON(env.PHOTOS_PRIVEES,BACKFILL_CURSOR,{nextPage});
      }else backfill={page,olderItems:0,status:"passerelle_non_deployee"};
    }
  }catch(e){archive={imported:0,routes:0,error:String(e)};}
  return {etat:"actualise",items,lastSync:syncedAt,archive,backfill};
}
