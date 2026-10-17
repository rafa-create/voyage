// Fonctionne à la racine (Cloudflare) et dans /voyage/ (GitHub Pages).
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function chemin(cheminRelatif: string): string {
  if (/^https?:\/\//i.test(cheminRelatif)) return cheminRelatif;
  return base + "/" + cheminRelatif.replace(/^\/+/, "");
}
