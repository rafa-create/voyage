# Guide IA — Carnet de voyage

## Objectif
Site de carnet de voyage en français, déployé sur Cloudflare Workers à https://voyage.site-ready.workers.dev/. Le dépôt est un projet Astro avec un Worker Cloudflare qui expose les API publiques et l'administration.

## Règles impératives
- Ne jamais lancer, relancer ou déclencher GitHub Actions à la demande : le quota peut être épuisé. Vérifier les workflows et privilégier les contrôles locaux qui n'appellent pas d'actions distantes.
- Ne jamais déployer automatiquement en production. Le déploiement touche le site public et doit être fait séparément, après vérification et accord explicite.
- Travailler directement sur la branche `main` pour toutes les modifications du dépôt. Ne pas créer de branches de fonctionnalité et ne pas ouvrir de pull requests / merge requests. Vérifier les fichiers et changements existants avant d'écrire, puis committer directement sur `main`.
- Ne jamais exposer de secrets, de jetons, ni de données privées. Les photos privées et l'authentification sont gérées par le Worker.
- Ne pas ajouter de dépendance ou modifier le lockfile sans nécessité vérifiée.

## Architecture
- `src/pages/`: pages Astro, dont `index.astro`, `journal.astro`, `galerie.astro`, `etapes/[slug].astro` et les pages `admin/`.
- `src/components/CarteItineraire.astro`: carte MapLibre, événements géolocalisés, photos et parcours sportifs.
- `src/lib/data.ts` et `src/data/etapes.json`: données statiques et types du carnet.
- `src/styles/global.css`: styles partagés.
- `worker/index.js`: API Cloudflare Worker; `worker/content.js` gère les étapes/photos/vidéos R2; `worker/auth.js` porte les contrôles d'accès.
- `tests/`: tests Node existants; `scripts/validate-etapes.mjs`: validation des données.

## API publiques utiles
- `GET /api/public/etapes`: étapes publiées.
- `GET /api/public/photos` et `GET /api/public/photos?etape=<slug>`: photos publiques et métadonnées.
- `GET /api/public/carte-evenements`: activités sportives publiées.
- `GET /api/public/defi/parcours/<uuid>`: points d'un parcours sportif public.
Les API d'administration nécessitent le mécanisme d'authentification existant; ne pas le contourner.

## Conventions de l'expérience
- Dates civiles en format `AAAA-MM-JJ`; afficher les heures si disponibles et conserver les fuseaux locaux lorsque l'API en fournit.
- Galerie : ordre chronologique décroissant (récent → ancien); une photo sans date doit rester accessible et être ordonnée de façon stable.
- Accueil par journée : la carte et la galerie doivent partager la même date sélectionnée. Si la veille est vide, choisir la dernière journée avec des événements plutôt que d'afficher une page vide.
- Carte : les gestes mobiles doivent permettre le déplacement à un doigt; éviter d'activer automatiquement plusieurs tracés sportifs qui se chevauchent. Le rayon de 2 km doit être calculé en distance géographique réelle, pas en degrés.
- Une photo sur la carte doit ouvrir la photo précise dans la galerie; préserver l'ordre chronologique global.
- Toute édition du journal en ligne doit être protégée par la session admin et utiliser les endpoints de mutation existants avec leurs contrôles d'origine/jeton.

## Vérification avant livraison
1. Inspecter `package.json` avant de choisir les commandes.
2. Exécuter les tests et la validation localement si l'environnement et les dépendances sont disponibles; indiquer clairement tout contrôle non exécuté.
3. Tester mobile, navigation clavier, états sans photos et photos sans métadonnées.
4. Ne pas supposer qu'une PR est déployée : l'URL de production ne change qu'après un déploiement réussi.
