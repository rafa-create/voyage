// Copie personnelle automatique des résumés et tracés simplifiés reçus
// depuis la passerelle du propriétaire. Aucun original FIT/GPX n'est fourni
// par cette API : ne pas présenter ces copies comme des fichiers originaux.
// Les copies restent privées tant que le propriétaire ne les publie pas.
import {getJSON,putJSON} from "./content.js";
import {archiveIndex} from "./parcours-archive.js";
import {privateStravaFetch} from "./strava-bridge.js";

const INDEX="__meta/parcours/index.json";
const PREFIX="__meta/parcours/archive/";
const MAP={
  Run:"course",TrailRun:"course",VirtualRun:"course",
  Ride:"velo",MountainBikeRide:"velo",GravelRide:"velo",
  EBikeRide:"velo",Kitesurf:"kitesurf",Soccer:"football",
  Football:"football",Walk:"marche",Hike:"marche"
};

function details(item){
  const id=String(item?.id||"");
  const fin=Number(item?.startedAtMs);
  const date=String(item?.date||"");
  const km=Number(item?.distanceMeters);
  if(!/^[1-9][0-9]{0,19}$/.test(id)||!Number.isFinite(fin)||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(km)||km<0)return null;
  const minutes=Number(item?.durationSeconds);
  const sportType=String(item.sportType||"Workout").slice(0,36);
  return {sourceId:"strava:"+id,date,fin,km:Math.round(km/10)/100,
    minutes:Number.isFinite(minutes)&&minutes>=0?Math.round(minutes/60):null,
    titre:String(item.name||"Activité sportive").slice(0,120),
    sport:MAP[sportType]||"autre",visibility:item.visibility||"unknown",
    public:item.visibility==="everyone",source:"import_automatique",routeState:"en_attente",
    importedAt:new Date().toISOString()};
}

function validRoute(data){
  const route=Array.isArray(data?.geoRoute)?data.geoRoute:[];
  return route.filter(point=>Array.isArray(point)&&point.length===2&&
    point.every(Number.isFinite)&&Math.abs(point[0])<=85&&Math.abs(point[1])<=180);
}
export async function archiveNewSports(env,items,{maxImports=8,maxRoutes=2}={}){
  if(!env.PHOTOS_PRIVEES||!Array.isArray(items)||!items.length)
    return {imported:0,routes:0};
  const indexed=await archiveIndex(env);
  const bySource=new Map(indexed.filter(a=>a.sourceId).map(a=>[a.sourceId,a]));
  const additions=[];
  // Importer les résumés sans exiger de traces GPS (sports en salle, football...).
  for(const item of [...items].sort((a,b)=>b.startedAtMs-a.startedAtMs)){
    const record=details(item);
    if(!record||bySource.has(record.sourceId))continue;
    record.id=crypto.randomUUID();
    bySource.set(record.sourceId,record);
    additions.push(record);
    if(additions.length>=maxImports)break;
  }
  if(additions.length){
    for(const item of additions)await putJSON(env.PHOTOS_PRIVEES,PREFIX+item.id+".json",{
      ...item,route:[]});
    await putJSON(env.PHOTOS_PRIVEES,INDEX,{items:[...indexed,...additions].slice(-6000)});
  }
  const history=additions.length?[...indexed,...additions].slice(-6000):indexed;
  let routes=0;
  const pending=history.filter(a=>a.source==="import_automatique"&&a.routeState==="en_attente")
    .sort((a,b)=>b.fin-a.fin).slice(0,Math.max(0,maxRoutes));
  if(pending.length){
    for(const item of pending){
      const activityId=item.sourceId?.split(":")[1];
      const result=await privateStravaFetch(env,"activities/"+activityId+"/route");
      if(result.status!==200)continue;
      const route=validRoute(result.body);
      const checked={...item,routeState:route.length>=2?"disponible":"absent"};
      if(route.length>=2){
        checked.latitude=route[Math.floor(route.length/2)][0];
        checked.longitude=route[Math.floor(route.length/2)][1];
        routes++;
      }
      const original=await getJSON(env.PHOTOS_PRIVEES,PREFIX+item.id+".json",null);
      await putJSON(env.PHOTOS_PRIVEES,PREFIX+item.id+".json",{
        ...(original||item),...checked,route});
      const where=history.findIndex(row=>row.id===item.id);
      if(where>=0)history[where]=checked;
    }
    await putJSON(env.PHOTOS_PRIVEES,INDEX,{items:history});
  }
  return {imported:additions.length,routes,total:history.length};
}
