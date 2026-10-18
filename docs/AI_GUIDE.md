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

## Accès au site et photos privées
- Le réglage administrateur « Qui peut consulter Voyages ? » est dans `src/pages/admin/index.astro`; il utilise `GET/POST /api/prive/admin/site-access`.
- Le Worker stocke ce réglage dans `PHOTOS_PRIVEES`, clé `__meta/site-access.json`. Valeurs admises : `open` et `restricted`. En l'absence de configuration, le mode est `open` afin de ne pas bloquer les visiteurs.
- En mode `open`, les pages et API publiques restent consultables sans connexion. En mode `restricted`, le Worker exige un JWT Cloudflare Access valide pour les routes qui ne sont pas déjà privées.
- **Ne jamais confondre la visibilité du site et celle des photos.** Le mode du site ne change pas le bucket utilisé pour les photos, ne publie pas de photo privée et ne remplace pas les contrôles d'accès existants sur `/espace/`, `/admin/`, `/api/prive/` et `/media-prive/`.
- Avant d'activer le mode restreint en production, vérifier la configuration Cloudflare Access, le comportement des pages statiques et des ressources (images, scripts, styles), et tester les accès en navigation privée. Ne pas considérer le mode restreint comme validé en production sans ces tests.
- Toute évolution de l'accès doit préserver la séparation des buckets `PHOTOS_PUBLIQUES` et `PHOTOS_PRIVEES`, ainsi que l'authentification côté Worker. Une simple restriction d'interface ne protège pas les données.
- Ne pas déployer automatiquement après une modification de ces règles; respecter la règle de déploiement séparé et d'accord explicite ci-dessus.

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

## Galerie — géolocalisation manuelle des photos
- La fenêtre d’édition d’une photo permet de lancer une recherche Google Maps à partir d’un nom ou d’une adresse.
- Après avoir choisi le point dans Google Maps, l’administrateur peut coller le lien complet; l’interface tente d’extraire les coordonnées depuis les formats d’URL Google Maps courants (`/@lat,lon`, `!3dlat!4dlon` ou une paire dans `q`/`query`). Les champs latitude/longitude restent éditables et les coordonnées sont sauvegardées via l’endpoint protégé existant `/api/prive/admin/photo-modifier`.
- Cette première version n’intègre pas les résultats Google Places dans la fenêtre et ne nécessite pas de clé API Google. Les liens courts ou les URL sans coordonnées peuvent ne pas être interprétables; dans ce cas, saisir les coordonnées manuellement.
- Aucun déploiement automatique; vérifier en navigateur la recherche, la récupération des coordonnées et leur persistance avant tout déploiement autorisé.

- Dans la fenêtre d’édition de la Galerie, le bouton rouge « Supprimer définitivement cette photo » est visible uniquement pour les administrateurs et les photos répertoriées dans la bibliothèque R2. Il demande confirmation puis appelle l’endpoint existant `POST /api/prive/admin/supprimer-photo` avec `key` et `visibilite`; l’API Worker impose déjà l’authentification admin et la protection `Origin`/`X-Voyage-Admin`. Après succès, la vignette est retirée de l’interface. Ne pas utiliser ce bouton pour des photos statiques provenant uniquement des fichiers du site.

## Galerie — accès direct à la position d’une photo
- Pour les photos renvoyées par `/api/public/photos` qui ont des coordonnées GPS valides et une date exploitable, la légende affiche « Voir sur la carte ».
- Le lien renvoie à l’accueil avec la clé de la photo, sa date et ses coordonnées; `CarteItineraire.astro` sélectionne le jour, centre la carte sur le marqueur correspondant et ouvre sa popup quand le marqueur est disponible. Les coordonnées de l’URL servent de repli pour centrer la carte.
- Les photos sans coordonnées GPS valides n’affichent pas ce bouton, car aucun point précis ne peut être ciblé.
- Ne pas déployer automatiquement; tester le flux depuis la galerie vers l’accueil en navigateur.

## Vérification avant livraison
1. Inspecter `package.json` avant de choisir les commandes.
2. Exécuter les tests et la validation localement si l'environnement et les dépendances sont disponibles; indiquer clairement tout contrôle non exécuté.
3. Tester mobile, navigation clavier, états sans photos et photos sans métadonnées.
4. Ne pas supposer qu'une PR est déployée : l'URL de production ne change qu'après un déploiement réussi.

## Incident — accueil figé et retrait de l'édition générique (2026-10-18)
- **Symptôme initial :** le site public fonctionnait, mais l'accueil se figeait en session administrateur avec la carte qui semblait charger à l'infini, notamment dans Brave et Safari; le Journal restait utilisable.
- **Correctif initial :** le commit [`834f4d23`](https://github.com/rafa-create/voyage/commit/834f4d23f80f30b17dec1b9db834b743cb510100) a désactivé l'édition inline sur l'accueil. L'utilisateur a confirmé que le problème était réglé.
- **Décision suivante :** retirer entièrement l'édition générique des textes (crayons flottants, éditeur inline, appel à `/api/prive/admin/textes-site`, repositionnement et observateur associés), car les changements de labels n'étaient pas répercutés sur le site public.
- **État actuel du code :** dans `src/layouts/Base.astro`, le script d'édition générique a été remplacé par un script réservé à la Galerie. Il ajoute uniquement le crayon de modification des commentaires de photos, après vérification de la session administrateur. Le `MutationObserver` est conservé exclusivement sur la Galerie afin de prendre en charge ses photos chargées dynamiquement. Les boutons d'ajout de photos et de vidéos et les outils d'administration dédiés ne sont pas visés par ce retrait.
- **Commit de retrait :** [`54201998`](https://github.com/rafa-create/voyage/commit/54201998b1faa8e78b787fdab3f219d63abb1147).
- **Limite de vérification :** le code a été modifié sur `main`; le site n'a pas été déployé automatiquement. Tester en production après déploiement autorisé : absence de crayons de texte sur les pages, ajout photo/vidéo dans la Galerie, édition d'une description de photo, fonctionnement du Journal, de la carte et des outils d'administration.
- **Prudence :** la cause exacte du gel initial n'a pas été isolée. Ne pas réintroduire l'édition générique sans une solution explicite et des tests dédiés.



## Résolution des liens courts Google Maps dans la galerie
- Le bouton de récupération GPS essaie d’abord d’extraire les coordonnées du lien fourni.
- Pour les liens courts Google Maps, il utilise `GET /api/public/resolve-maps-link?url=...` côté Worker afin d’éviter les limites CORS du navigateur.
- L’endpoint n’accepte que des URL HTTPS de domaines Google Maps autorisés et contrôle chaque hôte de redirection, avec un nombre de redirections limité. Il renvoie l’URL finale pour l’extraction côté navigateur ; il ne garantit pas que Google fournisse toujours des coordonnées.
- Si Google bloque la résolution ou si le lien final ne contient pas de coordonnées lisibles, l’interface indique une solution de repli manuelle. Aucun déploiement en production sans autorisation explicite.
