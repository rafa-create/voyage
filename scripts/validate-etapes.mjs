import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const racine = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fichier = resolve(racine, "src/data/etapes.json");
const erreurs = [];
const erreur = (message) => erreurs.push(message);
const estTexte = (valeur) => typeof valeur === "string" && valeur.trim().length > 0;

let etapes;
try {
  etapes = JSON.parse(readFileSync(fichier, "utf8"));
} catch (e) {
  console.error(`Impossible de lire ${fichier} : ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(etapes)) {
  console.error("src/data/etapes.json doit contenir une liste JSON ([] au départ).");
  process.exit(1);
}

const slugs = new Set();
for (const [index, etape] of etapes.entries()) {
  const prefixe = `Étape ${index + 1}`;
  if (!etape || typeof etape !== "object" || Array.isArray(etape)) {
    erreur(`${prefixe} : un objet est attendu.`);
    continue;
  }
  for (const champ of ["slug", "date", "pays", "ville", "titre", "texte"]) {
    if (!estTexte(etape[champ])) erreur(`${prefixe} : ${champ} doit être un texte non vide.`);
  }
  if (estTexte(etape.slug)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(etape.slug)) {
      erreur(`${prefixe} : slug invalide (« ${etape.slug} ») ; utiliser minuscules, chiffres et tirets.`);
    }
    if (slugs.has(etape.slug)) erreur(`${prefixe} : slug en double (« ${etape.slug} »).`);
    slugs.add(etape.slug);
  }
  if (estTexte(etape.date)) {
    const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etape.date);
    if (!correspondance) {
      erreur(`${prefixe} : date attendue au format AAAA-MM-JJ.`);
    } else {
      const [, annee, mois, jour] = correspondance.map(Number);
      const date = new Date(Date.UTC(annee, mois - 1, jour));
      if (date.getUTCFullYear() !== annee || date.getUTCMonth() + 1 !== mois || date.getUTCDate() !== jour) {
        erreur(`${prefixe} : date impossible (« ${etape.date} »).`);
      }
    }
  }
  if (!Array.isArray(etape.photos)) {
    erreur(`${prefixe} : photos doit être une liste (éventuellement vide).`);
  } else {
    for (const [numero, photo] of etape.photos.entries()) {
      const etiquette = `${prefixe}, photo ${numero + 1}`;
      if (!photo || typeof photo !== "object" || Array.isArray(photo)) {
        erreur(`${etiquette} : un objet est attendu.`);
        continue;
      }
      if (!estTexte(photo.alt)) erreur(`${etiquette} : ajouter un texte alternatif (alt).`);
      if (!estTexte(photo.src) || !/^\/photos\/[a-zA-Z0-9/_-]+\.(?:webp|jpe?g|png|avif)$/i.test(photo.src)) {
        erreur(`${etiquette} : chemin invalide ; attendre /photos/... avec image webp, jpeg, png ou avif.`);
        continue;
      }
      const basePhotos = resolve(racine, "public/photos");
      const fichierPhoto = resolve(racine, "public", photo.src.slice(1));
      if (!fichierPhoto.startsWith(basePhotos + sep)) {
        erreur(`${etiquette} : chemin hors du dossier public/photos.`);
      } else if (!existsSync(fichierPhoto)) {
        erreur(`${etiquette} : fichier absent (« ${photo.src} »).`);
      }
    }
  }
  if (!Array.isArray(etape.videos)) {
    erreur(`${prefixe} : videos doit être une liste (éventuellement vide).`);
  } else {
    for (const [numero, video] of etape.videos.entries()) {
      const etiquette = `${prefixe}, vidéo ${numero + 1}`;
      if (!video || typeof video !== "object" || Array.isArray(video)) {
        erreur(`${etiquette} : un objet est attendu.`);
        continue;
      }
      if (!estTexte(video.titre)) erreur(`${etiquette} : ajouter un titre.`);
      try {
        const url = new URL(video.url);
        if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be", "www.youtube-nocookie.com"].includes(url.hostname)) {
          erreur(`${etiquette} : utiliser un lien YouTube HTTPS.`);
        }
      } catch {
        erreur(`${etiquette} : URL invalide.`);
      }
    }
  }
}
if (erreurs.length) {
  console.error(`Validation impossible : ${erreurs.length} problème(s) détecté(s) :\n- ${erreurs.join("\n- ")}`);
  process.exit(1);
}
console.log(`Contenu validé : ${etapes.length} étape(s).`);
