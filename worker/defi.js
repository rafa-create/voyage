import { getJSON, putJSON, validDate } from "./content.js";

const CONFIG_KEY="__meta/defi/config.json";
// Valeurs provisoires pour tester le défi avant d'activer l'espace administrateur.
// Toute configuration enregistrée dans R2 remplace ces valeurs.
const DEFAULT_CONFIG=Object.freeze({
  debut:"2026-10-17",
  chessUsername:"rafaelorset",
  timezone:"Europe/Paris"
});
const CHESS_KEY="__meta/defi/chess.json";
const STRAVA_KEY="__meta/defi/strava.json";
const STRAVA_FEED_KEY="__meta/defi/strava-public-feed.json";
const DEFAULT_STRAVA_FEED="https://www.strava.com/athletes/149399419/latest-rides/c85af98e34bbb4ad9d034058d986ba9dda5ae24f";
const DEFAULT_STRAVA_SUMMARY="https://www.strava.com/athletes/149399419/activity-summary/c85af98e34bbb4ad9d034058d986ba9dda5ae24f";
const MAX_DAYS=1095;
const MAX_MONTHS_PER_SYNC=12;
const usernamePattern=/^[a-zA-Z0-9_-]{3,30}$/;

export function dateInZone(value,timezone) {
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  try{
    const parts=new Intl.DateTimeFormat("en-GB",{
      timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(date);
    const part=type=>parts.find(p=>p.type===type)?.value;
    return part("year")+"-"+part("month")+"-"+part("day");
  }catch{return null;}
}
function addDays(date,delta=1){
  const d=new Date(date+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+delta);
  return d.toISOString().slice(0,10);
}
function monthList(start,end){
  const result=[];
  let y=Number(start.slice(0,4)),m=Number(start.slice(5,7));
  const untilY=Number(end.slice(0,4)),untilM=Number(end.slice(5,7));
  while(y<untilY||(y===untilY&&m<=untilM)){
    result.push(String(y)+"/"+String(m).padStart(2,"0"));
    m++;
    if(m===13){y++;m=1;}
    if(result.length>360)break;
  }
  return result;
}
export function validateConfig(input){
  if(!input||!validDate(input.debut))return null;
  if(!usernamePattern.test(input.chessUsername||""))return null;
  const timezone=String(input.timezone||"Europe/Paris").trim();
  try {new Intl.DateTimeFormat("fr",{timeZone:timezone});}
  catch{return null;}
  if(timezone.length>80)return null;
  if(input.debut>new Date().toISOString().slice(0,10))return null;
  return {debut:input.debut,chessUsername:input.chessUsername.trim(),timezone};
}
export async function getChallengeConfig(env){
  return getJSON(env.PHOTOS_PRIVEES,CONFIG_KEY,DEFAULT_CONFIG);
}
export async function setChallengeConfig(env,input){
  const next=validateConfig(input);
  if(!next)throw Error("Date de début, pseudo Chess.com ou fuseau horaire invalide.");
  const previous=await getChallengeConfig(env);
  if(previous?.chessUsername?.toLowerCase()!==next.chessUsername.toLowerCase()||previous?.timezone!==next.timezone){
    await putJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games:[],lastSync:null,username:next.chessUsername});
  }
  await putJSON(env.PHOTOS_PRIVEES,CONFIG_KEY,next);
  return next;
}
export function chessResult(game,username){
  const white=String(game.white?.username||"").toLowerCase()===username.toLowerCase();
  const black=String(game.black?.username||"").toLowerCase()===username.toLowerCase();
  if(!white&&!black)return null;
  const result=(white?game.white:game.black)?.result;
  if(result==="win")return "Victoire";
  if(["agreed","repetition","stalemate","insufficient","50move","timevsinsufficient"].includes(result))return "Nulle";
  return "Défaite";
}
export function normalizeChessGame(game,username,timezone){
  if(!Number.isFinite(Number(game.end_time))||!game.url?.startsWith("https://www.chess.com/"))return null;
  const result=chessResult(game,username);
  if(!result)return null;
  const date=dateInZone(Number(game.end_time)*1000,timezone);
  if(!date)return null;
  const player=String(game.white?.username||"").toLowerCase()===username.toLowerCase()?game.white:game.black;
  const rating=Number(player?.rating);
  const mode=String(game.time_class||"");
  return {date,result,url:game.url,fin:Number(game.end_time),
    rating:Number.isInteger(rating)&&rating>0&&rating<4000?rating:null,
    mode:["bullet","blitz","rapid","daily"].includes(mode)?mode:null};
}
export async function syncChess(env,{recentOnly=false,minIntervalMs=0}={}){
  const config=await getChallengeConfig(env);
  if(!config)return {ok:false,message:"Configure d'abord le défi depuis l'administration."};
  const today=dateInZone(new Date(),config.timezone);
  const months=monthList(config.debut,today);
  const old=await getJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games:[]});
  if(minIntervalMs>0 && old.lastSync && Date.now()-new Date(old.lastSync).getTime()<minIntervalMs){
    return {ok:true,skipped:true,parties:(old.games||[]).length,misAJour:old.lastSync};
  }
  // Sur la page publique, lire uniquement le mois actuel et le précédent :
  // pas besoin de recharger tout l'historique à chaque visite.
  const toFetch=months.slice(recentOnly?-2:-MAX_MONTHS_PER_SYNC);
  const all=new Map((old.games||[]).filter(x=>x.url).map(x=>[x.url,x]));
  let fetched=0;
  for(const month of toFetch){
    const endpoint="https://api.chess.com/pub/player/"+encodeURIComponent(config.chessUsername)+"/games/"+month;
    const response=await fetch(endpoint,{headers:{"Accept":"application/json","User-Agent":"VoyageCarnet/1.0 contact: carnet-de-voyage"}});
    if(!response.ok)throw Error("Chess.com a répondu "+response.status+" : réessaie plus tard.");
    const payload=await response.json();
    for(const game of (payload.games||[])){
      const normalized=normalizeChessGame(game,config.chessUsername,config.timezone);
      if(normalized&&normalized.date>=config.debut)all.set(normalized.url,normalized);
    }
    fetched++;
  }
  const games=[...all.values()].filter(g=>g.date>=config.debut).sort((a,b)=>a.fin-b.fin).slice(-8000);
  // Le classement actuel doit être celui de la cadence correspondante.
  // Une partie blitz n'est jamais comparée à une partie rapid.
  let ratingStats=old.ratingStats||{};
  try{
    const response=await fetch("https://api.chess.com/pub/player/"+encodeURIComponent(config.chessUsername)+"/stats",{
      headers:{"Accept":"application/json","User-Agent":"VoyageCarnet/1.0 contact: carnet-de-voyage"}});
    if(response.ok){
      const body=await response.json();
      ratingStats=Object.fromEntries(["bullet","blitz","rapid","daily"].map(mode=>[
        mode,Number(body?.["chess_"+mode]?.last?.rating)||null]));
    }
  }catch{}
  await putJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games,ratingStats,username:config.chessUsername,lastSync:new Date().toISOString(),partial:months.length>MAX_MONTHS_PER_SYNC});
  return {ok:true,parties:games.length,moisSynchronises:fetched,historiquePartiel:months.length>MAX_MONTHS_PER_SYNC};
}
// L'actualisation publique synchronise les parties récentes avec un délai anti-abus.
// Le délai s'applique aussi aux appels en échec, pour ne pas saturer Chess.com.
const PUBLIC_POLL_KEY="__meta/defi/chess-public-poll.json";
const PUBLIC_POLL_MIN_MS=120000;

export async function freshPublicChallenge(env){
  const config=await getChallengeConfig(env);
  if(!config)return {configured:false};
  let sync={etat:"cache",prochaineVerification:null};
  const now=Date.now();
  const previous=await getJSON(env.PHOTOS_PRIVEES,PUBLIC_POLL_KEY,null);
  const elapsed=previous?.at?now-new Date(previous.at).getTime():Infinity;
  if(Number.isFinite(elapsed)&&elapsed>=0&&elapsed<PUBLIC_POLL_MIN_MS){
    sync={etat:"cache",prochaineVerification:Math.ceil((PUBLIC_POLL_MIN_MS-elapsed)/1000)};
  }else{
    // Marquer la tentative avant tout appel réseau (y compris si Chess.com échoue).
    await putJSON(env.PHOTOS_PRIVEES,PUBLIC_POLL_KEY,{at:new Date(now).toISOString()});
    try{
      const response=await syncChess(env,{recentOnly:true,minIntervalMs:PUBLIC_POLL_MIN_MS});
      sync={etat:response.skipped?"cache":"actualise",prochaineVerification:PUBLIC_POLL_MIN_MS/1000};
    }catch(e){
      sync={etat:"erreur",prochaineVerification:PUBLIC_POLL_MIN_MS/1000};
    }
  }
  // Mettre aussi à jour les dernières courses publiquement visibles,
  // avec un plafond d'un appel toutes les dix minutes.
  const stravaSync=await syncPublicRuns(env);
  const current=await publicChallenge(env);
  return {...current,synchronisation:sync,stravaSynchronisation:stravaSync};
}

// Intégration officielle du flux Strava (widget servi par Strava).
// Il n'utilise ni jeton OAuth, ni copie des activités, ni API Strava.
export function parsePublicStravaFeed(input){
  if(typeof input!=="string"||input.length>2500)return null;
  const trimmed=input.trim();
  if(!trimmed)return "";
  const iframe=/<iframe\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1/i.exec(trimmed);
  const candidate=(iframe?iframe[2]:trimmed).replaceAll("&amp;","&");
  try{
    const url=new URL(candidate);
    if(url.protocol!=="https:"||url.hostname!=="www.strava.com"||
       !/^\/athletes\/[1-9][0-9]{0,19}\/(?:latest-rides|activity-summary)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname))
      return null;
    if(url.username||url.password)return null;
    for(const key of url.searchParams.keys())if(!["show_rides"].includes(key))return null;
    return url.href;
  }catch{return null;}
}
// Ces deux widgets publics fournis par le propriétaire se mettent à jour
// chez Strava : le site n'a pas besoin de télécharger leurs données.
export async function getPublicStravaWidgets(env){
  const stored=await getJSON(env.PHOTOS_PRIVEES,STRAVA_FEED_KEY,null);
  const feed=stored && Object.hasOwn(stored,"url")
    ?parsePublicStravaFeed(stored.url)
    :DEFAULT_STRAVA_FEED;
  const summary=stored && Object.hasOwn(stored,"summary")
    ?parsePublicStravaFeed(stored.summary)
    :DEFAULT_STRAVA_SUMMARY;
  return {
    feed:feed??DEFAULT_STRAVA_FEED,
    summary:summary??DEFAULT_STRAVA_SUMMARY
  };
}
export async function setPublicStravaFeed(env,input){
  const feed=parsePublicStravaFeed(typeof input==="string"?input:input?.feed);
  const summary=parsePublicStravaFeed(typeof input==="string"?DEFAULT_STRAVA_SUMMARY:input?.summary);
  if(feed===null||summary===null)throw Error("Colle les codes d'intégration officiels de ton profil Strava.");
  await putJSON(env.PHOTOS_PRIVEES,STRAVA_FEED_KEY,{url:feed,summary});
  return {feed,summary};
}

export function normalizeStravaActivity(input){
  if(!input||!validDate(input.date)||typeof input.titre!=="string"||!input.titre.trim()||input.titre.length>120)return null;
  const km=Number(input.km);
  if(!Number.isFinite(km)||km<=0||km>1000)return null;
  let url;
  try{
    const u=new URL(input.url);
    if(u.protocol!=="https:"||!["strava.com","www.strava.com"].includes(u.hostname)||!/^\/activities\/\d+\/?$/.test(u.pathname))return null;
    url="https://www.strava.com"+u.pathname.replace(/\/$/,"");
  }catch{return null;}
  return {date:input.date,km:Math.round(km*100)/100,titre:input.titre.trim(),url};
}
export async function addStravaActivity(env,input){
  const config=await getChallengeConfig(env);
  if(!config)throw Error("Configure d'abord le défi.");
  const item=normalizeStravaActivity(input);
  if(!item||item.date<config.debut)throw Error("Activité invalide : date, titre, distance ou lien Strava public.");
  const all=await getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]);
  const without=(Array.isArray(all)?all:[]).filter(a=>a.url!==item.url);
  const next=[...without,{...item,ajouteLe:new Date().toISOString()}].sort((a,b)=>a.date.localeCompare(b.date));
  await putJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,next);
  return item;
}
export async function deleteStravaActivity(env,url){
  const items=await getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]);
  if(!Array.isArray(items)||!items.some(a=>a.url===url))throw Error("Activité introuvable.");
  await putJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,items.filter(a=>a.url!==url));
}
const PUBLIC_RUNS_KEY="__meta/defi/strava-public-recent.json";
const PUBLIC_RUNS_POLL_KEY="__meta/defi/strava-public-poll.json";
const PUBLIC_ROUTE_PREFIX="__meta/defi/route-public/";
const PUBLIC_RUNS_INTERVAL=10*60*1000;

export async function syncPublicRuns(env){
  if(!env.PHOTOS_PRIVEES||!env.VOYAGE_BRIDGE_KEY)return {etat:"non_configure"};
  const now=Date.now();
  const last=await getJSON(env.PHOTOS_PRIVEES,PUBLIC_RUNS_POLL_KEY,null);
  const elapsed=last?.at?now-Date.parse(last.at):Infinity;
  if(Number.isFinite(elapsed)&&elapsed>=0&&elapsed<PUBLIC_RUNS_INTERVAL)return {etat:"cache"};
  await putJSON(env.PHOTOS_PRIVEES,PUBLIC_RUNS_POLL_KEY,{at:new Date(now).toISOString()});
  try{
    const {privateStravaFetch}=await import("./strava-bridge.js");
    const response=await privateStravaFetch(env,"activities");
    if(response.status!==200)throw Error(response.body?.error||"Synchronisation Strava impossible.");
    // Seules les courses déjà explicitement publiques chez Strava
    // sont projetées dans la page publique, jamais les courses privées.
    const config=await getChallengeConfig(env);
    const items=(response.body.items||[]).filter(a=>a.visibility==="everyone")
      .map(a=>{
        const startedAtMs=Number(a.startedAtMs);
        const date=dateInZone(startedAtMs,config.timezone);
        const meters=Number(a.distanceMeters);
        const id=String(a.id||"");
        if(!/^[1-9][0-9]{0,19}$/.test(id)||!validDate(date)||
          !Number.isFinite(meters)||meters<=0)return null;
        return {id,date,fin:startedAtMs,
          km:Math.round(meters/10)/100,
          minutes:Math.max(1,Math.round(Number(a.durationSeconds||0)/60)),
          titre:String(a.name||"Course à pied").slice(0,120),
          url:"https://www.strava.com/activities/"+id,source:"strava"};
      }).filter(Boolean).sort((a,b)=>b.fin-a.fin).slice(0,10);
    await putJSON(env.PHOTOS_PRIVEES,PUBLIC_RUNS_KEY,{items,misAJour:new Date().toISOString()});
    return {etat:"actualise",count:items.length};
  }catch(e){return {etat:"erreur"};}
}

export async function publicRoute(env,id){
  if(!/^[1-9][0-9]{0,19}$/.test(String(id)))return null;
  const recent=await getJSON(env.PHOTOS_PRIVEES,PUBLIC_RUNS_KEY,{items:[]});
  if(!recent.items?.some(item=>item.id===id))return null;
  const key=PUBLIC_ROUTE_PREFIX+id+".json";
  const existing=await getJSON(env.PHOTOS_PRIVEES,key,null);
  if(existing&&Date.now()-Date.parse(existing.at)<24*3600*1000)return existing.route;
  const {privateStravaFetch}=await import("./strava-bridge.js");
  const response=await privateStravaFetch(env,"activities/"+id+"/route");
  if(response.status!==200)return null;
  const points=(Array.isArray(response.body?.geoRoute)?response.body.geoRoute:[])
    .filter(p=>Array.isArray(p)&&p.length===2&&
      Number.isFinite(p[0])&&Number.isFinite(p[1])&&
      Math.abs(p[0])<=85&&Math.abs(p[1])<=180);
  // Atténuation du risque d'exposer une adresse précise au début ou à la fin.
  const trim=points.length>=20?Math.ceil(points.length*.07):0;
  const route=points.slice(trim,points.length-trim).slice(0,110);
  if(route.length<2)return null;
  await putJSON(env.PHOTOS_PRIVEES,key,{at:new Date().toISOString(),route});
  return route;
}

export function summarizeChallenge(config,chess,activities,today){
  if(!config||!validDate(config.debut)||!validDate(today)||today<config.debut)return {configured:false};
  const games=Array.isArray(chess?.games)?chess.games:[];
  const runs=Array.isArray(activities)?activities:[];
  const gamesByDay=new Map(),activityByDay=new Map();
  const orderedGames=[...games].filter(g=>validDate(g.date)&&g.date>=config.debut&&g.date<=today)
    .sort((a,b)=>a.fin-b.fin);
  // Elo de la cadence exacte du jour, pas un mélange blitz/rapid.
  const previousModeRating=new Map();
  for(const g of orderedGames){
    const previous=previousModeRating.get(g.mode);
    const delta=g.rating!=null&&previous!=null?g.rating-previous:null;
    if(g.rating!=null&&g.mode)previousModeRating.set(g.mode,g.rating);
    const existing=gamesByDay.get(g.date);
    if(!existing||Number(g.fin)>Number(existing.fin))
      gamesByDay.set(g.date,{...g,eloDelta:delta,count:1});
  }
  for(const a of runs){
    if(!validDate(a.date)||a.date<config.debut||a.date>today)continue;
    // Une seule activité par journée, la plus récente : ordre chronologique réel
    // pour Strava, ordre d'ajout pour les saisies manuelles.
    const existing=activityByDay.get(a.date);
    const time=Number(a.fin||Date.parse(a.ajouteLe||"")||0);
    const oldTime=Number(existing?.fin||Date.parse(existing?.ajouteLe||"")||0);
    const auto=Boolean(a.id&&a.source==="strava");
    const existingAuto=Boolean(existing?.id&&existing?.source==="strava");
    if(!existing||(auto&&!existingAuto)||
      (auto===existingAuto&&(time>oldTime||(time===oldTime&&String(a.url)>String(existing.url)))))
      activityByDay.set(a.date,{...a,kmTotal:Number(a.km),count:1});
  }
  const days=[];
  for(let date=config.debut;date<=today&&days.length<MAX_DAYS;date=addDays(date)){
    const game=gamesByDay.get(date)||null,activity=activityByDay.get(date)||null;
    days.push({date,echecs:game,activite:activity,
      resultat:game&&activity?"reussi":date===today?"en_cours":"manque"});
  }
  const finished=days.filter(d=>d.date<today);
  const completed=finished.filter(d=>d.resultat==="reussi").length;
  const latestRated=orderedGames.filter(g=>g.rating!=null&&g.mode).at(-1);
  const mode=latestRated?.mode||"rapid";
  const sameMode=orderedGames.filter(g=>g.mode===mode&&g.rating!=null);
  const previous=sameMode.length>1?sameMode.at(-2)?.rating:null;
  const rating=chess?.ratingStats?.[mode]||latestRated?.rating||null;
  const delta=rating!=null&&previous!=null?rating-previous:null;
  return {configured:true,debut:config.debut,timezone:config.timezone,username:config.chessUsername,
    misAJour:chess?.lastSync||null,historiquePartiel:Boolean(chess?.partial),
    elo:{rating,mode,delta,tendance:delta==null?"stable":delta>0?"hausse":delta<0?"baisse":"stable",
      historique:sameMode.slice(-12).map(g=>({date:g.date,fin:g.fin,rating:g.rating}))},
    stats:{jours:days.length,joursEchecs:days.filter(d=>d.echecs).length,
      joursActivites:days.filter(d=>d.activite).length,joursComplets:days.filter(d=>d.resultat==="reussi").length,
      reussite:finished.length?Math.round(completed/finished.length*100):null,joursTermines:finished.length},
    jours:days.reverse()};
}
export async function publicChallenge(env){
  const config=await getChallengeConfig(env);
  if(!config)return {configured:false};
  const [chess,manual,snapshot]=await Promise.all([
    getJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games:[],lastSync:null}),
    getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]),
    getJSON(env.PHOTOS_PRIVEES,PUBLIC_RUNS_KEY,{items:[],misAJour:null})
  ]);
  const auto=Array.isArray(snapshot.items)?snapshot.items:[];
  const manualNotDuplicate=(Array.isArray(manual)?manual:[]).filter(a=>!auto.some(b=>b.url===a.url));
  const result=summarizeChallenge(config,chess,[...manualNotDuplicate,...auto],dateInZone(new Date(),config.timezone));
  const widgets=await getPublicStravaWidgets(env);
  return {...result,stravaFeed:widgets.feed,stravaSummary:widgets.summary,
    coursesRecentes:auto,derniereCourseSynchro:snapshot.misAJour||null};
}
export async function privateChallenge(env){
  const result=await publicChallenge(env);
  const activities=await getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]);
  return {...result,activitesEnregistrees:activities};
}
