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

// Polyline résumé présent dans la liste des activités : permet d'afficher
// une carte immédiatement, même si la lecture GPS détaillée est indisponible.
export function decodeSummaryPolyline(encoded){
  if(typeof encoded!=="string"||!encoded||encoded.length>16000)return [];
  const points=[];let cursor=0,lat=0,lon=0;
  const part=()=>{
    let result=0,shift=0,byte=0;
    do{
      if(cursor>=encoded.length||shift>30)throw Error("Tracé incomplet");
      byte=encoded.charCodeAt(cursor++)-63;
      if(byte<0||byte>63)throw Error("Tracé invalide");
      result|=(byte&31)<<shift;shift+=5;
    }while(byte>=32);
    return result&1?~(result>>1):result>>1;
  };
  try{
    while(cursor<encoded.length){
      lat+=part();lon+=part();
      const point=[lat/100000,lon/100000];
      if(!Number.isFinite(point[0])||!Number.isFinite(point[1])||
        Math.abs(point[0])>85||Math.abs(point[1])>180)return [];
      points.push(point);
      if(points.length>25000)return [];
    }
  }catch{return [];}
  if(points.length<2)return [];
  if(points.length<=120)return points;
  return Array.from({length:120},(_,i)=>points[Math.round(i*(points.length-1)/119)]);
}

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
  const route=Array.isArray(data?.geoRoute)&&data.geoRoute.length<=100000?data.geoRoute:[];
  const points=route.filter(point=>Array.isArray(point)&&point.length===2&&
    point.every(Number.isFinite)&&Math.abs(point[0])<=85&&Math.abs(point[1])<=180);
  return points.length>=2?points:[];
}
function sampleRoute(points,max){
  if(points.length<=max)return points;
  return Array.from({length:max},(_,i)=>points[Math.round(i*(points.length-1)/(max-1))]);
}
export async function archiveNewSports(env,items,{maxImports=8,maxRoutes=2}={}){
  if(!env.PHOTOS_PRIVEES||!Array.isArray(items)||!items.length)
    return {imported:0,routes:0,total:0};
  const indexed=await archiveIndex(env);
  const bySource=new Map(indexed.filter(a=>a.sourceId).map(a=>[a.sourceId,a]));
  const additions=[];
  let modified=false;
  const sorted=[...items].sort((a,b)=>b.startedAtMs-a.startedAtMs);
  // Toutes les activités sont identifiées par leur ID distant, quel que soit
  // l'appareil d'origine. Ne jamais écraser un original GPX existant.
  for(const item of sorted){
    const record=details(item);
    if(!record)continue;
    const existing=bySource.get(record.sourceId);
    const preview=decodeSummaryPolyline(item.summaryPolyline);
    const position=Array.isArray(item.startLatlng)&&item.startLatlng.length===2&&
      item.startLatlng.every(Number.isFinite)&&Math.abs(item.startLatlng[0])<=85&&
      Math.abs(item.startLatlng[1])<=180?item.startLatlng:null;
    if(existing){
      if(position&&!Number.isFinite(existing.latitude)){
        existing.latitude=position[0];existing.longitude=position[1];
        modified=true;
      }
      // Si l'activité a changé de visibilité, remettre l'index à jour.
      const visibility=record.visibility;
      const changed=existing.visibility!==visibility;
      if(changed){
        existing.visibility=visibility;
        existing.public=visibility==="everyone";
        modified=true;
      }
      // Réparer les archives constituées AVANT que la passerelle n'envoie
      // le tracé résumé (c'était le cas des premières copies R2).
      if(preview.length>=2&&existing.routeState!=="disponible"&&
         existing.routeState!=="resume"){
        const midpoint=preview[Math.floor(preview.length/2)];
        const upgraded={...existing,latitude:midpoint[0],longitude:midpoint[1],
          routeState:"resume"};
        Object.assign(existing,upgraded);
        const stored=await getJSON(env.PHOTOS_PRIVEES,PREFIX+existing.id+".json",null);
        await putJSON(env.PHOTOS_PRIVEES,PREFIX+existing.id+".json",{
          ...(stored||existing),...upgraded,route:preview
        });
        modified=true;
      }
      continue;
    }
    if(additions.length>=Math.max(0,maxImports))continue;
    record.id=crypto.randomUUID();
    if(position){
      record.latitude=position[0];
      record.longitude=position[1];
    }
    const hasPreview=preview.length>=2;
    if(hasPreview){
      const midpoint=preview[Math.floor(preview.length/2)];
      record.latitude=midpoint[0];record.longitude=midpoint[1];
      record.routeState="resume";
    }
    bySource.set(record.sourceId,record);
    additions.push({record,route:hasPreview?preview:[]});
  }
  const history=[...indexed,...additions.map(x=>x.record)];
  for(const {record,route} of additions)
    await putJSON(env.PHOTOS_PRIVEES,PREFIX+record.id+".json",{...record,route});
  if(modified||additions.length)
    await putJSON(env.PHOTOS_PRIVEES,INDEX,{items:history});

  let routes=0;
  // Compléter les tracés sans aperçu. Une indisponibilité temporaire de
  // l'un ne doit pas bloquer les autres activités.
  const pending=history.filter(a=>a.source==="import_automatique"&&
    ["en_attente","resume"].includes(a.routeState)&&
    (!a.routeRetryAt||Date.parse(a.routeRetryAt)<=Date.now()))
    .sort((a,b)=>b.fin-a.fin).slice(0,Math.max(0,maxRoutes));
  if(pending.length){
    for(const item of pending){
      const activityId=item.sourceId?.split(":")[1];
      const result=await privateStravaFetch(env,"activities/"+activityId+"/route");
      const route=result.status===200?validRoute(result.body):[];
      const failed=result.status!==200;
      const checked={...item,
        routeState:failed?"en_attente":route.length>=2?"disponible":"absent",
        routeRetryAt:failed?new Date(Date.now()+6*3600000).toISOString():null,
        routeAttempts:Number(item.routeAttempts||0)+1};
      if(route.length>=2){
        checked.latitude=route[Math.floor(route.length/2)][0];
        checked.longitude=route[Math.floor(route.length/2)][1];
        routes++;
      }
      const stored=await getJSON(env.PHOTOS_PRIVEES,PREFIX+item.id+".json",null);
      await putJSON(env.PHOTOS_PRIVEES,PREFIX+item.id+".json",{
        ...(stored||item),...checked,
        ...(route.length>=2?{routeDetail:sampleRoute(route,5000),routeFull:route}:{}),
        route:route.length>=2?sampleRoute(route,120):[]});
      Object.assign(item,checked);
    }
    await putJSON(env.PHOTOS_PRIVEES,INDEX,{items:history});
  }
  return {imported:additions.length,routes,total:history.length};
}
