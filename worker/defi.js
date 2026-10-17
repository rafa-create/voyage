import { getJSON, putJSON, validDate } from "./content.js";

const CONFIG_KEY="__meta/defi/config.json";
const CHESS_KEY="__meta/defi/chess.json";
const STRAVA_KEY="__meta/defi/strava.json";
const MAX_DAYS=1095;
const MAX_MONTHS_PER_SYNC=12;
const usernamePattern=/^[a-zA-Z0-9_-]{3,30}$/;

export function dateInZone(value,timezone) {
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  try{
    return new Intl.DateTimeFormat("en-CA",{
      timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"
    }).format(date);
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
  return getJSON(env.PHOTOS_PRIVEES,CONFIG_KEY,null);
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
  return {date,result,url:game.url,fin:Number(game.end_time)};
}
export async function syncChess(env){
  const config=await getChallengeConfig(env);
  if(!config)return {ok:false,message:"Configure d'abord le défi depuis l'administration."};
  const today=dateInZone(new Date(),config.timezone);
  const months=monthList(config.debut,today);
  const toFetch=months.slice(-MAX_MONTHS_PER_SYNC);
  const old=await getJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games:[]});
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
  await putJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games,username:config.chessUsername,lastSync:new Date().toISOString(),partial:months.length>MAX_MONTHS_PER_SYNC});
  return {ok:true,parties:games.length,moisSynchronises:fetched,historiquePartiel:months.length>MAX_MONTHS_PER_SYNC};
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
  const next=[...without,item].sort((a,b)=>a.date.localeCompare(b.date));
  await putJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,next);
  return item;
}
export async function deleteStravaActivity(env,url){
  const items=await getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]);
  if(!Array.isArray(items)||!items.some(a=>a.url===url))throw Error("Activité introuvable.");
  await putJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,items.filter(a=>a.url!==url));
}
export function summarizeChallenge(config,chess,activities,today){
  if(!config||!validDate(config.debut)||!validDate(today)||today<config.debut)return {configured:false};
  const games=Array.isArray(chess?.games)?chess.games:[];
  const runs=Array.isArray(activities)?activities:[];
  const gamesByDay=new Map(),activityByDay=new Map();
  for(const g of games){
    if(validDate(g.date)&&g.date>=config.debut&&g.date<=today){
      const existing=gamesByDay.get(g.date);
      if(!existing||g.fin>existing.fin)gamesByDay.set(g.date,{...g,count:(existing?.count||0)+1});
    }
  }
  for(const a of runs){
    if(validDate(a.date)&&a.date>=config.debut&&a.date<=today){
      const existing=activityByDay.get(a.date);
      if(!existing)activityByDay.set(a.date,{...a,kmTotal:Number(a.km),count:1});
      else activityByDay.set(a.date,{...a,kmTotal:existing.kmTotal+Number(a.km),count:existing.count+1});
    }
  }
  const days=[];
  for(let date=config.debut;date<=today&&days.length<MAX_DAYS;date=addDays(date)){
    const game=gamesByDay.get(date)||null,activity=activityByDay.get(date)||null;
    days.push({date,echecs:game,activite:activity,
      resultat:game&&activity?"reussi":date===today?"en_cours":"manque"});
  }
  const fini=days.filter(d=>d.date<today);
  const completed=fini.filter(d=>d.resultat==="reussi").length;
  const chessDays=days.filter(d=>d.echecs).length;
  const stravaDays=days.filter(d=>d.activite).length;
  return {configured:true,debut:config.debut,timezone:config.timezone,username:config.chessUsername,
    misAJour:chess?.lastSync||null,historiquePartiel:Boolean(chess?.partial),
    stats:{jours:days.length,joursEchecs:chessDays,joursActivites:stravaDays,joursComplets:days.filter(d=>d.resultat==="reussi").length,
      reussite:fini.length?Math.round(completed/fini.length*100):null,joursTermines:fini.length},
    jours:days.reverse()};
}
export async function publicChallenge(env){
  const config=await getChallengeConfig(env);
  if(!config)return {configured:false};
  const [chess,activities]=await Promise.all([
    getJSON(env.PHOTOS_PRIVEES,CHESS_KEY,{games:[],lastSync:null}),
    getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[])
  ]);
  return summarizeChallenge(config,chess,activities,dateInZone(new Date(),config.timezone));
}
export async function privateChallenge(env){
  const result=await publicChallenge(env);
  const activities=await getJSON(env.PHOTOS_PRIVEES,STRAVA_KEY,[]);
  return {...result,activitesEnregistrees:activities};
}
