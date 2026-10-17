import donnees from "../data/etapes.json";

export interface Photo {
  src: string;
  alt: string;
  legende?: string;
}

export interface Video {
  url: string;
  titre: string;
}

export interface Etape {
  slug: string;
  date: string; // AAAA-MM-JJ
  pays: string;
  ville: string;
  latitude?: number;
  longitude?: number;
  statut?: "passee" | "actuelle" | "future";
  titre: string;
  texte: string;
  photos: Photo[];
  videos: Video[];
}

export interface Pays {
  nom: string;
  slug: string;
  etapes: Etape[];
}

export const etapes: Etape[] = [...(donnees as Etape[])].sort((a, b) =>
  b.date.localeCompare(a.date)
);

export function slugifier(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const nomsPays = [...new Set(etapes.map((etape) => etape.pays))];

export const pays: Pays[] = nomsPays
  .map((nom) => ({
    nom,
    slug: slugifier(nom),
    etapes: etapes.filter((etape) => etape.pays === nom),
  }))
  .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

export const galerie = etapes.flatMap((etape) =>
  etape.photos.map((photo, index) => ({
    ...photo,
    etape,
    id: etape.slug + "-" + index,
  }))
);

export function dateFr(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}

export function idYoutube(url: string): string | null {
  try {
    const adresse = new URL(url);
    const hote = adresse.hostname.toLowerCase();
    let id = "";

    if (hote === "youtu.be" || hote === "www.youtu.be") {
      id = adresse.pathname.split("/")[1] || "";
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(hote)) {
      const morceaux = adresse.pathname.split("/");
      id = adresse.pathname === "/watch"
        ? adresse.searchParams.get("v") || ""
        : ["embed", "shorts", "live"].includes(morceaux[1])
          ? morceaux[2] || ""
          : "";
    }

    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
