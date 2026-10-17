// Seule la partie admin authentifiée de Voyage peut appeler ce module.
// Les jetons Strava restent exclusivement dans BeatOnStep (D1 chiffré).
const BASE="https://beatonstep.app/api/voyage/strava/";
export async function privateStravaFetch(env,action){
  const secret=String(env.VOYAGE_BRIDGE_KEY||"");
  if(secret.length<40)return {
    status:503,body:{error:"Connexion BeatOnStep non activée : renseigne VOYAGE_BRIDGE_KEY sur les deux Workers."}
  };
  const path=action==="activities"?"activities":
    /^activities\/[1-9][0-9]{0,19}\/route$/.test(action)?action:null;
  if(!path)return {status:400,body:{error:"Action Strava invalide."}};
  try{
    const response=await fetch(BASE+path,{
      headers:{"X-Voyage-Bridge-Key":secret,"Accept":"application/json"},
      redirect:"manual",
      cf:{cacheTtl:0,cacheEverything:false}
    });
    if(response.status===404)return {status:503,body:{
      error:"Connexion Strava absente ou pont non reconnu sur BeatOnStep. Vérifie la connexion dans l'application et le secret commun."
    }};
    if(!response.ok)return {status:502,body:{error:
      response.status===429?"Trop de demandes à Strava. Réessaie plus tard.":
        "Lecture Strava indisponible via BeatOnStep (HTTP "+response.status+")."
    }};
    const body=await response.json();
    // Le pont ne doit jamais renvoyer des jetons, même par erreur.
    if(action==="activities")return {status:200,body:{
      items:Array.isArray(body?.items)?body.items.slice(0,100):[]
    }};
    return {status:200,body:{
      geoRoute:Array.isArray(body?.geoRoute)?body.geoRoute.slice(0,120):null,
      elevationGainMeters:Number.isFinite(body?.elevationGainMeters)?body.elevationGainMeters:null,
      routeUnavailableReason:body?.routeUnavailableReason||null
    }};
  }catch{return {status:502,body:{error:"Impossible de joindre BeatOnStep pour l'instant."}};}
}
