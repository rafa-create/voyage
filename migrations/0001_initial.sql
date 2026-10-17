-- Schéma initial du carnet de voyage.
-- Les fichiers médias sont dans R2 ou sur YouTube, pas dans D1.
-- Aucune photo ni donnée privée ne doit être publiée dans le dépôt GitHub.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS voyages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  titre TEXT NOT NULL,
  description TEXT,
  date_debut TEXT,
  date_fin TEXT,
  cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etapes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  pays_id INTEGER NOT NULL REFERENCES pays(id),
  slug TEXT NOT NULL UNIQUE,
  date_etape TEXT NOT NULL,
  ville TEXT NOT NULL,
  titre TEXT NOT NULL,
  recit TEXT NOT NULL DEFAULT '',
  publiee INTEGER NOT NULL DEFAULT 0 CHECK (publiee IN (0, 1)),
  cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  etape_id INTEGER REFERENCES etapes(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  titre TEXT NOT NULL,
  description TEXT,
  visibilite TEXT NOT NULL DEFAULT 'public'
    CHECK (visibilite IN ('public', 'prive')),
  cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  type_media TEXT NOT NULL CHECK (type_media IN ('photo', 'video')),
  -- Chemins des objets R2 (pas des liens publics) pour les photos.
  cle_r2 TEXT,
  cle_miniature_r2 TEXT,
  lien_youtube TEXT,
  titre TEXT,
  texte_alternatif TEXT,
  legende TEXT,
  date_prise_vue TEXT,
  ordre INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (type_media = 'photo' AND cle_r2 IS NOT NULL AND lien_youtube IS NULL)
    OR
    (type_media = 'video' AND lien_youtube IS NOT NULL AND cle_r2 IS NULL)
  )
);

-- Liste d'autorisation par album, à vérifier côté serveur après
-- authentification Cloudflare Access. Cette table NE protège rien seule.
CREATE TABLE IF NOT EXISTS acces_albums (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (album_id, email)
);

CREATE INDEX IF NOT EXISTS idx_etapes_voyage_date
  ON etapes(voyage_id, date_etape DESC);
CREATE INDEX IF NOT EXISTS idx_etapes_pays_date
  ON etapes(pays_id, date_etape DESC);
CREATE INDEX IF NOT EXISTS idx_albums_etape
  ON albums(etape_id);
CREATE INDEX IF NOT EXISTS idx_medias_album_ordre
  ON medias(album_id, ordre);
