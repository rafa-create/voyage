import { requireAccess } from "./auth.js";
import etapesInitiales from "../src/data/etapes.json";

const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif" };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "Content-Type": "application/json; charset=utf-8" } });
}
function error(message, status = 400) { return json({ error: message }, status); }
function slugOk(slug) { return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length < 90; }
function imageKey(key) {
  return Boolean(key && key.length < 700 && !key.split("/").some((x) => !x || x === "." || x === "..") && /\.(?:jpe?g|png|webp|avif|gif)$/i.test(key));
}
function filenameUrl(path) {
  try { return decodeURIComponent(path); } catch { return null; }
}
function contentType(key, object) {
  const ext = key.split(".").pop().toLowerCase();
  return object?.httpMetadata?.contentType || types[ext] || "application/octet-stream";
}
function isMutationAllowed(request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin && request.headers.get("X-Voyage-Admin") === "1";
}
async function getJSON(bucket, key, fallback) {
  const result = await bucket.get(key);
  if (!result) return fallback;
  try { return await result.json(); } catch { return fallback; }
}
async function putJSON(bucket, key, value) {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}
async function listAll(bucket, options, max = 5000) {
  const items = [];
  let cursor;
  do {
    const list = await bucket.list({ ...options, limit: 1000, cursor, include: ["customMetadata"] });
    items.push(...list.objects);
    if (items.length >= max) break;
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return items.slice(0, max);
}
async function stages(env) {
  const bucket = env.PHOTOS_PRIVEES;
  if (!bucket) return [...etapesInitiales];
  const meta = await listAll(bucket, { prefix: "__meta/etapes/" }, 250);
  const more = await Promise.all(meta.filter(x => x.key.endsWith(".json")).map(x => getJSON(bucket, x.key, null)));
  const map = new Map(etapesInitiales.map(e => [e.slug, { ...e }]));
  for (const step of more) if (step && slugOk(step.slug)) map.set(step.slug, step);
  const active = await getJSON(bucket, "__meta/config.json", { actuelle: "la-ciotat" });
  const all = [...map.values()];
  const hasCurrent = all.some(e => e.slug === active.actuelle);
  return all.map(e => ({ ...e, statut: hasCurrent ? e.slug === active.actuelle ? "actuelle" : (e.statut === "future" ? "future" : "passee") : e.statut })).sort((a,b) => b.date.localeCompare(a.date));
}
async function mediaList(bucket, prefix) {
  const objects = await listAll(bucket, { prefix }, 5000);
  return objects.filter(x => imageKey(x.key) && x.key.startsWith("etapes/")).map(x => ({
    src: (bucket === undefined ? "" : "") + x.key,
    key: x.key,
    etape: x.key.split("/")[1],
    alt: x.customMetadata?.alt || "Photographie du voyage",
    legende: x.customMetadata?.legende || "",
    ajouteLe: x.uploaded?.toISOString() || null,
  }));
}
async function readImage(request, bucket, key, priv = false) {
  if (!bucket) return error("Stockage non configuré.", 503);
  if (!imageKey(key) || (priv && !key.startsWith("etapes/"))) return new Response("Introuvable", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Méthode non autorisée", { status: 405 });
  const object = request.method === "HEAD" ? await bucket.head(key) : await bucket.get(key);
  if (!object) return new Response("Introuvable", { status: 404 });
  const headers = new Headers({ "Content-Type": contentType(key, object), "X-Content-Type-Options": "nosniff", "Cache-Control": priv ? "private, no-store" : "public, max-age=3600" });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
function validateStage(input) {
  const step = {};
  for (const field of ["slug", "ville", "pays", "titre", "date"]) {
    if (typeof input?.[field] !== "string" || !input[field].trim() || input[field].length > 150) return null;
    step[field] = input[field].trim();
  }
  if (!slugOk(step.slug) || !/^\d{4}-\d{2}-\d{2}$/.test(step.date)) return null;
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) return null;
  step.latitude = input.latitude;
  step.longitude = input.longitude;
  step.texte = typeof input.texte === "string" ? input.texte.slice(0, 6000) : "";
  step.photos = []; step.videos = []; step.statut = "future";
  return step;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Image publique, lecture seulement. Ne jamais exposer le bucket privé ici.
    if (pathname.startsWith("/media/")) return readImage(request, env.PHOTOS_PUBLIQUES, filenameUrl(pathname.slice(7)));

    // API publique : seules les clés du bucket public sont renvoyées.
    if (pathname === "/api/public/etapes" && request.method === "GET") return json({ etapes: await stages(env) });
    if (pathname === "/api/public/photos" && request.method === "GET") {
      const slug = url.searchParams.get("etape");
      if (slug !== null && !slugOk(slug)) return error("Étape invalide.");
      const photos = await mediaList(env.PHOTOS_PUBLIQUES, slug ? "etapes/" + slug + "/" : "etapes/");
      return json({ photos: photos.map(({ key, ...photo }) => ({ ...photo, src: "/media/" + key })) });
    }

    const protectedRoute = pathname.startsWith("/espace/") || pathname.startsWith("/admin/") ||
      pathname.startsWith("/api/prive/") || pathname.startsWith("/media-prive/");
    // Les étapes créées dans l'administration ont une page dynamique sans rebuild.
    if (request.method === "GET" && /^\/etapes\/[a-z0-9-]+\/?$/.test(pathname)) {
      const staticPage = await env.ASSETS.fetch(request);
      if (staticPage.status !== 404) return staticPage;
      const slug = pathname.split("/").filter(Boolean)[1];
      if (!(await stages(env)).some(e => e.slug === slug)) return staticPage;
      return env.ASSETS.fetch(new Request(new URL("/etape/", url.origin), request));
    }

    if (!protectedRoute) return env.ASSETS.fetch(request);

    const adminOnly = pathname.startsWith("/admin/") || pathname.startsWith("/api/prive/admin/");
    const auth = await requireAccess(request, env, adminOnly);
    if (auth.error) return auth.error;
    if (!env.PHOTOS_PRIVEES) return error("Bucket privé non connecté.", 503);

    if (pathname.startsWith("/media-prive/")) {
      const key = filenameUrl(pathname.slice("/media-prive/".length));
      return readImage(request, env.PHOTOS_PRIVEES, key, true);
    }
    if (pathname.startsWith("/espace/") || pathname.startsWith("/admin/")) {
      const page = await env.ASSETS.fetch(request);
      const headers = new Headers(page.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(page.body, { status: page.status, headers });
    }

    if (pathname === "/api/prive/moi" && request.method === "GET") return json(auth.user);
    if (pathname === "/api/prive/etapes" && request.method === "GET") return json({ etapes: await stages(env) });
    if (pathname === "/api/prive/photos" && request.method === "GET") {
      const photos = await mediaList(env.PHOTOS_PRIVEES, "etapes/");
      return json({ photos: photos.map(({ key, ...photo }) => ({ ...photo, src: "/media-prive/" + key })) });
    }

    if (!auth.user.isAdmin) return error("Accès administrateur requis.", 403);
    if (request.method !== "POST" || !isMutationAllowed(request)) return error("Action non autorisée.", 403);

    if (pathname === "/api/prive/admin/etapes") {
      let input;
      try { input = await request.json(); } catch { return error("JSON invalide."); }
      const step = validateStage(input);
      if (!step) return error("Étape invalide (ville, pays, date, coordonnées obligatoires).");
      const all = await stages(env);
      if (all.some(e => e.slug === step.slug)) return error("Cet identifiant d'étape existe déjà.", 409);
      await putJSON(env.PHOTOS_PRIVEES, "__meta/etapes/" + step.slug + ".json", step);
      return json({ ok: true, etape: step }, 201);
    }

    if (pathname === "/api/prive/admin/actuelle") {
      let input;
      try { input = await request.json(); } catch { return error("JSON invalide."); }
      const slug = input?.slug;
      if (!slugOk(slug) || !(await stages(env)).some(x => x.slug === slug)) return error("Étape inconnue.");
      await putJSON(env.PHOTOS_PRIVEES, "__meta/config.json", { actuelle: slug });
      return json({ ok: true, actuelle: slug });
    }

    if (pathname === "/api/prive/admin/upload") {
      const slug = url.searchParams.get("etape");
      const visibilite = url.searchParams.get("visibilite");
      const all = await stages(env);
      if (!slugOk(slug) || !all.some(e => e.slug === slug)) return error("Étape inconnue.");
      if (!["public", "prive"].includes(visibilite)) return error("Visibilité invalide.");
      const type = request.headers.get("Content-Type")?.split(";")[0]?.toLowerCase();
      const extension = Object.entries(types).find(([e, t]) => t === type && e !== "jpg")?.[0];
      if (!extension) return error("Utilisez JPEG, PNG, WebP, AVIF ou GIF.");
      const taille = Number(request.headers.get("Content-Length"));
      if (taille && taille > 12 * 1024 * 1024) return error("Photo trop volumineuse (12 Mo max).", 413);
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) return error("Photo vide ou trop volumineuse.", 413);
      const key = "etapes/" + slug + "/" + crypto.randomUUID() + "." + extension;
      const bucket = visibilite === "public" ? env.PHOTOS_PUBLIQUES : env.PHOTOS_PRIVEES;
      const alt = url.searchParams.get("alt")?.slice(0, 160) || "Photo de " + all.find(x => x.slug === slug).ville;
      await bucket.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { alt, legende: "", etape: slug } });
      return json({ ok: true, etape: slug, visibilite, src: (visibilite === "public" ? "/media/" : "/media-prive/") + key }, 201);
    }

    return error("Route inconnue.", 404);
  },
};
