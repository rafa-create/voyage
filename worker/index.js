/**
 * Route publique de lecture des images R2.
 * Aucune écriture, aucun listing et aucun accès au bucket privé.
 * Exemple : /media/japon/tokyo-01.webp => clé R2 "japon/tokyo-01.webp"
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/media/")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Méthode non autorisée", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    let key;
    try {
      key = decodeURIComponent(url.pathname.slice("/media/".length));
    } catch {
      return new Response("Chemin invalide", { status: 400 });
    }

    const segments = key.split("/");
    const isImage = /\.(?:avif|gif|jpe?g|png|webp)$/i.test(key);
    if (!key || !isImage || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      return new Response("Image introuvable", { status: 404 });
    }

    const photo = request.method === "HEAD"
      ? await env.PHOTOS_PUBLIQUES.head(key)
      : await env.PHOTOS_PUBLIQUES.get(key);

    if (!photo) {
      return new Response("Image introuvable", { status: 404 });
    }

    const headers = new Headers();
    photo.writeHttpMetadata(headers);
    if (!headers.has("Content-Type")) {
      const extension = key.split(".").pop().toLowerCase();
      const mime = {
        avif: "image/avif", gif: "image/gif", jpg: "image/jpeg",
        jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      };
      headers.set("Content-Type", mime[extension]);
    }
    headers.set("ETag", photo.httpEtag);
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(request.method === "HEAD" ? null : photo.body, {
      status: 200,
      headers,
    });
  },
};
