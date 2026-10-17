import { requireAccess } from "./auth.js";
import { privateStravaFetch } from "./strava-bridge.js";
import {syncRecentSports} from "./sport-sync.js";
import * as exifr from "exifr";
import {importGpx,publicArchives,archiveMapPoints,archiveIndex} from "./parcours-archive.js";
import { publicChallenge, freshPublicChallenge, privateChallenge, setChallengeConfig, syncChess, addStravaActivity, deleteStravaActivity, setPublicStravaFeed, publicRoute } from "./defi.js";
import {
  types, slugOk, imageKey, validDate, photoPath,
  getJSON, putJSON, steps, matchStep, listedPhotos, videos, urlYoutube,
  getCaptureDate, movePhoto, legacyPhotos
} from "./content.js";

const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...noStore,"Content-Type":"application/json; charset=utf-8"}});}
function error(message,status=400){return json({error:message},status);}
function decode(path){try{return decodeURIComponent(path);}catch{return null;}}
function mime(key,object){return object?.httpMetadata?.contentType||types[key.split(".").pop().toLowerCase()]||"application/octet-stream";}
function mutationOk(request){return request.headers.get("Origin")===new URL(request.url).origin&&request.headers.get("X-Voyage-Admin")==="1";}
function bucketFor(env,v){return v==="public"?env.PHOTOS_PUBLIQUES:v==="prive"?env.PHOTOS_PRIVEES:null;}
function validateStage(input){
  const step={};
  for(const key of ["slug","ville","pays","titre","date"]){
    if(typeof input?.[key]!=="string"||!input[key].trim()||input[key].length>150)return null;
    step[key]=input[key].trim();
  }
  if(!slugOk(step.slug)||!validDate(step.date))return null;
  if(input.dateFin&&!validDate(input.dateFin))return null;
  if(input.dateFin&&input.dateFin<step.date)return null;
  if(!Number.isFinite(input.latitude)||!Number.isFinite(input.longitude)||Math.abs(input.latitude)>90||Math.abs(input.longitude)>180)return null;
  step.latitude=input.latitude;
  step.longitude=input.longitude;
  step.dateFin=input.dateFin||null;
  step.texte=typeof input.texte==="string"?input.texte.slice(0,6000):"";
  step.photos=[];step.videos=[];step.statut="future";
  return step;
}
async function readImage(request,bucket,key,priv=false,allowUnclassified=false){
  if(!bucket)return error("Bucket non configuré.",503);
  if(!imageKey(key)||(priv&&!allowUnclassified&&!key.startsWith("etapes/")))return new Response("Introuvable",{status:404});
  if(!["GET","HEAD"].includes(request.method))return new Response("Méthode non autorisée",{status:405});
  const object=request.method==="HEAD"?await bucket.head(key):await bucket.get(key);
  if(!object)return new Response("Introuvable",{status:404});
  const headers=new Headers({"Content-Type":mime(key,object),"Cache-Control":priv?"private, no-store":"public, max-age=60","X-Content-Type-Options":"nosniff"});
  if(object.httpEtag)headers.set("ETag",object.httpEtag);
  return new Response(request.method==="HEAD"?null:object.body,{headers});
}
async function readBody(request){try{return await request.json();}catch{return null;}}
async function stageExists(env,slug){return slugOk(slug)&&(await steps(env)).some(x=>x.slug===slug);}
function makePublicSteps(all){
  return all.map(e=>({slug:e.slug,date:e.date,dateFin:e.dateFin||null,pays:e.pays,ville:e.ville,titre:e.titre,texte:e.texte||"",latitude:e.latitude,longitude:e.longitude,statut:e.statut,videos:[],photos:[]}));
}
async function synchroniserR2(env) {
  // Une passe courte et bornée pour respecter les quotas gratuits.
  const all=await steps(env);
  let matched=0,unclassified=0,examined=0;
  for(const visibility of ["public","prive"]){
    const bucket=bucketFor(env,visibility);
    const photos=await listedPhotos(env,visibility);
    for(const photo of photos.filter(p=>!p.etape).sort((a,b)=>(b.ajouteLe||"").localeCompare(a.ajouteLe||"")).slice(0,4)){
      examined++;
      const date=photo.datePrise||await getCaptureDate(bucket,photo.key);
      const stage=matchStep(date,all);
      if(!stage){unclassified++;continue;}
      const name="etapes/"+stage.slug+"/"+crypto.randomUUID()+"."+photo.key.split(".").pop().toLowerCase();
      await movePhoto(bucket,bucket,photo.key,name,{etape:stage.slug,...(date?{datePrise:date}:{})});
      matched++;
    }
  }
  return {ok:true,examined,matched,unclassified};
}

async function enrichirPositionsPhotos(env){
  // Traitement lent et borné : jusqu'à quatre photos publiques anciennes par jour.
  // Une photo sans GPS est marquée comme examinée pour ne plus être relue.
  const items=await env.PHOTOS_PUBLIQUES.list({limit:1000,include:["customMetadata"]});
  const todo=items.objects.filter(item=>imageKey(item.key)&&
    item.customMetadata?.geoScanned!=="1").slice(0,4);
  for(const item of todo){
    const photo=await env.PHOTOS_PUBLIQUES.get(item.key);
    if(!photo)continue;
    const buffer=await photo.arrayBuffer();
    let coords=null,dateHeure=null;
    try{coords=await exifr.gps(buffer);}catch{}
    try{
      const data=await exifr.parse(buffer,{pick:["DateTimeOriginal","CreateDate","DateTimeDigitized"],reviveValues:false});
      const value=data?.DateTimeOriginal||data?.CreateDate||data?.DateTimeDigitized;
      const m=typeof value==="string"?/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value):null;
      if(m)dateHeure=m[1]+"-"+m[2]+"-"+m[3]+"T"+m[4]+":"+m[5]+":"+m[6];
    }catch{}
    const valid=coords&&Number.isFinite(coords.latitude)&&Number.isFinite(coords.longitude)&&
      Math.abs(coords.latitude)<=85&&Math.abs(coords.longitude)<=180;
    await env.PHOTOS_PUBLIQUES.put(item.key,buffer,{
      httpMetadata:photo.httpMetadata,
      customMetadata:{...(photo.customMetadata||{}),geoScanned:"1",
        ...(dateHeure?{datePrise:dateHeure.slice(0,10),dateHeure}:{}),
        ...(valid?{latitude:String(coords.latitude),longitude:String(coords.longitude),precision:"exact"}:{})}
    });
  }
}

export default {
  async scheduled(event,env,ctx){
    // L'activité sportive est vérifiée toutes les deux heures.
    ctx.waitUntil(syncRecentSports(env).catch(e=>console.warn("Synchronisation des activités sportives:",String(e))));
    // Les imports des photos et le retrait des caches restent quotidiens.
    if(event.cron!=="0 4 * * *")return;
    ctx.waitUntil(synchroniserR2(env));
    ctx.waitUntil(enrichirPositionsPhotos(env).catch(e=>console.warn("Localisation photos:",String(e))));
    ctx.waitUntil(syncChess(env).catch(e=>console.warn("Synchronisation Chess.com:",String(e))));
    ctx.waitUntil((async()=>{
      const marker="__meta/defi/cache-api-nettoye.json";
      const already=await getJSON(env.PHOTOS_PRIVEES,marker,null);
      if(already)return;
      const {cleanupLegacyApiCache}=await import("./defi.js");
      await cleanupLegacyApiCache(env);
      await putJSON(env.PHOTOS_PRIVEES,marker,{at:new Date().toISOString()});
    })().catch(e=>console.warn("Nettoyage du cache:",String(e))));
  },
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;

    if(path.startsWith("/media/"))return readImage(request,env.PHOTOS_PUBLIQUES,decode(path.slice(7)));
    if(path==="/api/public/defi"&&request.method==="GET")return json(await freshPublicChallenge(env,{forceSports:url.searchParams.get("actualiser")==="1"}));
    if(path==="/api/public/parcours"&&request.method==="GET")return json({parcours:await publicArchives(env)});
    if(path==="/api/public/carte-evenements"&&request.method==="GET"){
      return json({courses:await archiveMapPoints(env)});
    }
    const publicGps=/^\/api\/public\/defi\/parcours\/([a-f0-9-]{36})$/.exec(path);
    if(publicGps&&request.method==="GET"){
      const points=await publicRoute(env,publicGps[1]);
      return points?json({route:points}):error("Parcours public indisponible.",404);
    }
    if(path==="/api/public/etapes"&&request.method==="GET")return json({etapes:makePublicSteps(await steps(env))});
    if(path==="/api/public/photos"&&request.method==="GET"){
      const slug=url.searchParams.get("etape");
      if(slug!==null&&!slugOk(slug))return error("Étape invalide.");
      const photos=await listedPhotos(env,"public");
      return json({photos:slug?photos.filter(p=>p.etape===slug):photos.filter(p=>p.etape)});
    }
    if(path==="/api/public/videos"&&request.method==="GET"){
      const slug=url.searchParams.get("etape");
      if(!await stageExists(env,slug))return error("Étape inconnue.",404);
      return json({videos:await videos(env,slug)});
    }

    // Pages d'étapes publiées via R2 accessibles immédiatement.
    if(request.method==="GET"&&/^\/etapes\/[a-z0-9-]+\/?$/.test(path)){
      const existing=await env.ASSETS.fetch(request);
      if(existing.status!==404)return existing;
      const slug=path.split("/").filter(Boolean)[1];
      if(!(await stageExists(env,slug)))return existing;
      return env.ASSETS.fetch(new Request(new URL("/etape/",url.origin),request));
    }

    if(request.method==="GET"&&/^\/pays\/[a-z0-9-]+\/?$/.test(path)){
      const page=await env.ASSETS.fetch(request);
      if(page.status!==404)return page;
      const slug=path.split("/").filter(Boolean)[1];
      const all=await steps(env);
      const normalize=x=>x.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      if(!all.some(e=>normalize(e.pays)===slug))return page;
      return env.ASSETS.fetch(new Request(new URL("/destination/",url.origin),request));
    }

    const priv=/^\/(?:espace|admin)(?:\/|$)/.test(path)||path.startsWith("/api/prive/")||path.startsWith("/media-prive/");
    if(!priv)return env.ASSETS.fetch(request);
    const adminOnly=/^\/admin(?:\/|$)/.test(path)||path.startsWith("/api/prive/admin/");
    const auth=await requireAccess(request,env,adminOnly);
    if(auth.error)return auth.error;
    if(!env.PHOTOS_PRIVEES)return error("Bucket privé non connecté.",503);
    if(path.startsWith("/media-prive/"))return readImage(request,env.PHOTOS_PRIVEES,decode(path.slice("/media-prive/".length)),true,auth.user.isAdmin);
    if(/^\/(?:espace|admin)(?:\/|$)/.test(path)){
      const page=await env.ASSETS.fetch(request);
      const headers=new Headers(page.headers);headers.set("Cache-Control","private, no-store");
      return new Response(page.body,{status:page.status,headers});
    }
    if(path==="/api/prive/moi"&&request.method==="GET")return json(auth.user);
    if(path==="/api/prive/admin/defi"&&request.method==="GET"&&auth.user.isAdmin)return json(await privateChallenge(env));
    if(path==="/api/prive/admin/defi/strava-recentes"&&request.method==="GET"&&auth.user.isAdmin){
      const result=await syncRecentSports(env);
      const stored=await archiveIndex(env);
      return json({items:result.items,etat:result.etat,lastSync:result.lastSync,
        archives:stored.filter(x=>x.source==="import_automatique").length,
        ...(result.reason?{error:result.reason}:{})});
    }
    const gps=/^\/api\/prive\/admin\/defi\/strava-parcours\/([1-9][0-9]{0,19})$/.exec(path);
    if(gps&&request.method==="GET"&&auth.user.isAdmin){
      const result=await privateStravaFetch(env,"activities/"+gps[1]+"/route");
      return json(result.body,result.status);
    }
    if(path==="/api/prive/etapes"&&request.method==="GET")return json({etapes:makePublicSteps(await steps(env))});
    if(path==="/api/prive/photos"&&request.method==="GET"){
      return json({photos:(await listedPhotos(env,"prive")).filter(p=>p.etape)});
    }
    if(!auth.user.isAdmin)return error("Accès administrateur requis.",403);
    if(path==="/api/prive/admin/media"&&request.method==="GET"){
      const pub=await listedPhotos(env,"public");
      const pri=await listedPhotos(env,"prive");
      return json({photos:[...pub,...pri].sort((a,b)=>(b.ajouteLe||"").localeCompare(a.ajouteLe||""))});
    }
    if(path==="/api/prive/admin/videos"&&request.method==="GET"){
      const slug=url.searchParams.get("etape");
      if(!await stageExists(env,slug))return error("Étape inconnue.");
      return json({videos:await videos(env,slug)});
    }
    if(request.method!=="POST"||!mutationOk(request))return error("Action non autorisée.",403);

    if(path==="/api/prive/admin/defi/import-gpx"){
      try{
        const form=await request.formData();
        return json({ok:true,parcours:await importGpx(env,form)},201);
      }catch(e){return error(e instanceof Error?e.message:"Import du GPX impossible.");}
    }
    if(path==="/api/prive/admin/defi/config"){
      const input=await readBody(request);
      try{return json({ok:true,config:await setChallengeConfig(env,input)});}
      catch(e){return error(e.message);}
    }
    if(path==="/api/prive/admin/defi/sports-synchroniser"){const result=await syncRecentSports(env,{force:true});return json(result);}
    if(path==="/api/prive/admin/defi/chess-synchroniser"){
      try{return json(await syncChess(env));}
      catch(e){return error("Synchronisation Chess.com impossible : "+e.message,502);}
    }
    if(path==="/api/prive/admin/defi/strava-flux"){
      const input=await readBody(request);
      try{return json({ok:true,widgets:await setPublicStravaFeed(env,{feed:input?.embed,summary:input?.summary})});}
      catch(e){return error(e.message);}
    }
    if(path==="/api/prive/admin/defi/strava-ajouter"){
      const input=await readBody(request);
      try{return json({ok:true,activite:await addStravaActivity(env,input)},201);}
      catch(e){return error(e.message);}
    }
    if(path==="/api/prive/admin/defi/strava-supprimer"){
      const input=await readBody(request);
      try{await deleteStravaActivity(env,input?.url);return json({ok:true});}
      catch(e){return error(e.message);}
    }
    if(path==="/api/prive/admin/etapes"){
      const input=await readBody(request),step=validateStage(input);
      if(!step)return error("Étape invalide : renseigne titre, ville, pays, dates et coordonnées.");
      if(await stageExists(env,step.slug))return error("Cet identifiant existe déjà.",409);
      await putJSON(env.PHOTOS_PRIVEES,"__meta/etapes/"+step.slug+".json",step);
      return json({ok:true,etape:step},201);
    }
    if(path==="/api/prive/admin/actuelle"){
      const input=await readBody(request);
      if(!await stageExists(env,input?.slug))return error("Étape inconnue.");
      await putJSON(env.PHOTOS_PRIVEES,"__meta/config.json",{actuelle:input.slug});
      return json({ok:true,actuelle:input.slug});
    }
    if(path==="/api/prive/admin/upload"){
      let slug=url.searchParams.get("etape");
      const visibilite=url.searchParams.get("visibilite");
      const auto=url.searchParams.get("auto")==="1";
      const all=await steps(env);
      if(!["public","prive"].includes(visibilite))return error("Visibilité invalide.");
      if(!slugOk(slug)||!all.some(e=>e.slug===slug))return error("Étape inconnue.");
      const type=request.headers.get("Content-Type")?.split(";")[0]?.toLowerCase();
      const extension=type==="image/jpeg"?"jpeg":Object.entries(types).find(([e,t])=>t===type)?.[0];
      if(!extension)return error("Utiliser JPEG, PNG, WebP, AVIF, HEIC ou HEIF.");
      const advertised=Number(request.headers.get("Content-Length"));
      if(advertised>12*1024*1024)return error("12 Mo maximum par photo.",413);
      const body=await request.arrayBuffer();
      if(!body.byteLength||body.byteLength>12*1024*1024)return error("Image vide ou trop volumineuse.",413);
      const d=url.searchParams.get("datePrise");
      let captured=validDate(d)?d:null;
      // L'admin essaie d'extraire la date EXIF avant l'envoi; la valeur d'origine
      // est une date de prise de vue, et non une date de dépôt dans R2.
      if(auto&&captured){
        const target=matchStep(captured,all);
        if(target)slug=target.slug;
      }
      const bucket=bucketFor(env,visibilite);
      const key="etapes/"+slug+"/"+crypto.randomUUID()+"."+extension;
      const alt="Photo de "+all.find(x=>x.slug===slug).ville;
      let coords=null;
      try{coords=await exifr.gps(body);}catch{}
      const valid=coords&&Number.isFinite(coords.latitude)&&Number.isFinite(coords.longitude)&&
        Math.abs(coords.latitude)<=85&&Math.abs(coords.longitude)<=180;
      // Le navigateur transmet les EXIF de l'original car la compression
      // côté iPhone supprime GPS et date de capture.
      const gpsLat=Number(url.searchParams.get("latitude"));
      const gpsLon=Number(url.searchParams.get("longitude"));
      const suppliedGps=url.searchParams.has("latitude")&&url.searchParams.has("longitude")&&
        Number.isFinite(gpsLat)&&Number.isFinite(gpsLon)&&Math.abs(gpsLat)<=85&&Math.abs(gpsLon)<=180;
      const latitude=valid?coords.latitude:suppliedGps?gpsLat:null;
      const longitude=valid?coords.longitude:suppliedGps?gpsLon:null;
      const dateHeure=url.searchParams.get("dateHeure");
      const hasTime=typeof dateHeure==="string"&&
        /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(dateHeure)&&
        validDate(dateHeure.slice(0,10))&&
        (!captured||dateHeure.slice(0,10)===captured);
      if(hasTime&&!captured)captured=dateHeure.slice(0,10);
      await bucket.put(key,body,{httpMetadata:{contentType:type},
        customMetadata:{alt,etape:slug,geoScanned:"1",
          ...(captured?{datePrise:captured}:{}),
          ...(hasTime?{dateHeure}:{ }),
          ...(latitude!==null?{latitude:String(latitude),longitude:String(longitude),precision:"exact"}:{})}});
      return json({ok:true,etape:slug,visibilite,datePrise:captured,src:photoPath(key,visibilite)},201);
    }
    if(path==="/api/prive/admin/video-ajouter"){
      const input=await readBody(request);
      if(!await stageExists(env,input?.slug))return error("Étape inconnue.");
      const id=urlYoutube(input?.url);
      if(!id||typeof input.titre!=="string"||!input.titre.trim()||input.titre.length>180)return error("Lien YouTube ou titre invalide.");
      const key="__meta/videos/"+input.slug+".json";
      const current=await getJSON(env.PHOTOS_PRIVEES,key,[]);
      if(current.length>=200)return error("Trop de vidéos sur cette étape.");
      const next={id:crypto.randomUUID(),url:"https://www.youtube.com/watch?v="+id,titre:input.titre.trim()};
      await putJSON(env.PHOTOS_PRIVEES,key,[...current,next]);
      return json({ok:true,video:next},201);
    }
    if(path==="/api/prive/admin/video-supprimer"){
      const input=await readBody(request);
      if(!await stageExists(env,input?.slug)||typeof input?.id!=="string")return error("Vidéo invalide.");
      const key="__meta/videos/"+input.slug+".json";
      const current=await getJSON(env.PHOTOS_PRIVEES,key,[]);
      if(!current.some(v=>v.id===input.id))return error("Vidéo introuvable.",404);
      await putJSON(env.PHOTOS_PRIVEES,key,current.filter(v=>v.id!==input.id));
      return json({ok:true});
    }
    if(path==="/api/prive/admin/synchroniser"){
      return json(await synchroniserR2(env));
    }
    if(path==="/api/prive/admin/assigner"||path==="/api/prive/admin/visibilite"||path==="/api/prive/admin/supprimer-photo"){
      const input=await readBody(request);
      const oldVis=input?.visibilite;
      const source=bucketFor(env,oldVis);
      const key=input?.key;
      if(!source||!imageKey(key))return error("Photo invalide.");
      const object=await source.head(key);
      if(!object)return error("La photo a déjà été supprimée : actualise la liste.",404);
      if(path==="/api/prive/admin/supprimer-photo"){
        await source.delete(key);return json({ok:true});
      }
      const legacy=legacyPhotos().find(x=>x.key===key&&oldVis==="public");
      const currentStep=key.startsWith("etapes/")?key.split("/")[1]:legacy?.etape;
      const slug=path.endsWith("/assigner")?input?.etape:currentStep;
      if(!await stageExists(env,slug))return error("Choisis d'abord une étape valide.");
      const toVis=path.endsWith("/visibilite")?input?.nouvelleVisibilite:oldVis;
      // Ne jamais exposer une photo privée brute : elle peut encore contenir le GPS/EXIF.
      if(oldVis==="prive"&&toVis==="public")return error("La photo privée doit être réencodée côté admin avant publication.",422);
      const to=bucketFor(env,toVis);
      if(!to)return error("Visibilité invalide.");
      if(toVis===oldVis&&key.startsWith("etapes/"+slug+"/"))return json({ok:true,src:photoPath(key,toVis)});
      const suffix=key.split(".").pop().toLowerCase();
      const newKey="etapes/"+slug+"/"+crypto.randomUUID()+"."+suffix;
      await movePhoto(source,to,key,newKey,{etape:slug});
      return json({ok:true,src:photoPath(newKey,toVis),visibilite:toVis});
    }
    return error("Route inconnue.",404);
  }
};
