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
  // Un voyage de 30 jours peut couvrir trois mois calendaires (31/01→01/03).
  // Lire les trois derniers mois garantit la récupération des parties Rapid.
  const toFetch=months.slice(recentOnly?-3:-MAX_MONTHS_PER_SYNC);
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

export async function freshPublicChallenge(env,{forceSports=false}={}){
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
  const stravaSync=await syncPublicRuns(env,{force:forceSports});
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
// Les données de l'API sportive sont temporaires : elles ne doivent pas devenir
// une archive permanente. Les archives conservables proviennent des fichiers
// GPX originaux fournis par le propriétaire, dans parcours-archive.js.
export async function syncPublicRuns(env,{force=false}={}){
  // L'ouverture de la page déclenche la mise à jour du cache PERSONNEL.
  // Le résultat du défi public reste exclusivement fondé sur les archives
  // indépendantes importées par le propriétaire.
  const {syncRecentSports}=await import("./sport-sync.js");
  const result=await syncRecentSports(env,{force});
  return {etat:result.etat};
}
export async function publicRoute(env,id){
  const {publicArchivedRoute}=await import("./parcours-archive.js");
  return publicArchivedRoute(env,String(id));
}
export async function cleanupLegacyApiCache(env){
  if(!env.PHOTOS_PRIVEES)return;
  const bucket=env.PHOTOS_PRIVEES;
  for(const key of [
    "__meta/defi/strava-public-recent.json",
    "__meta/defi/strava-public-history.json",
    "__meta/defi/strava-public-poll.json"
  ])await bucket.delete(key);
  const listed=await bucket.list({prefix:"__meta/defi/route-public/",limit:1000});
  if(listed.objects.length)await bucket.delete(listed.objects.map(item=>item.key));
}
export function summarizeChallenge(config,chess,activities,today){
  if(!config||!validDate(config.debut)||!validDate(today)||today<config.debut)return {configured:false};
  const games=Array.isArray(chess?.games)?chess.games:[];
  const runs=Array.isArray(activities)?activities:[];
  const gamesByDay=new Map(),activityByDay=new Map();
  const orderedGames=[...games].filter(g=>g.mode==="rapid"&&validDate(g.date)&&g.date>=config.debut&&g.date<=today)
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
    const auto=Boolean(a.id&&["strava","archive"].includes(a.source));
    const existingAuto=Boolean(existing?.id&&["strava","archive"].includes(existing.source));
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
  const latestRated=orderedGames.filter(g=>g.rating!=null).at(-1);
  const mode="rapid";
  const sameMode=orderedGames.filter(g=>g.mode===mode&&g.rating!=null);
  const previous=sameMode.length>1?sameMode.at(-2)?.rating:null;
  const rating=chess?.ratingStats?.rapid||latestRated?.rating||null;
  const delta=sameMode.length>1 ? sameMode.at(-1).rating-previous : null;
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
  const {publicArchives}=await import("./parcours-archive.js");
  const [chess,manual,auto,widgets]=await Promise.all([
    getJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games:[],lastSync:null}),
    getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]),
    publicArchives(env),
    getPublicStravaWidgets(env)
  ]);
  const own=Array.isArray(manual)?manual:[];
  const activities=[...own,...auto].filter(a=>a?.date);
  const result=summarizeChallenge(config,chess,activities,dateInZone(new Date(),config.timezone));
  return {...result,stravaFeed:widgets.feed,stravaSummary:widgets.summary,
    coursesRecentes:auto,derniereCourseSynchro:null};
}
export async function privateChallenge(env){
  const result=await publicChallenge(env);
  const activities=await getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]);
  return {...result,activitesEnregistrees:activities};
}
