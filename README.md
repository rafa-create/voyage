# Carnet de voyage

Site personnel de voyage réalisé avec Astro : journal chronologique, pages par pays, galerie photo et vidéos YouTube. Le dépôt est public : **ne jamais y ajouter de photo privée**.

## Utilisation locale

Prérequis : Node.js 22.12 ou plus récent.

1. Installer les dépendances : npm install
2. Démarrer le site : npm run dev
3. Vérifier le build : npm run build

## Ajouter une étape

Toutes les données publiques sont dans **src/data/etapes.json** (une liste JSON). Ajouter un objet par étape, par exemple :

    [
      {
        "slug": "exemple-premiere-etape",
        "date": "2026-10-17",
        "pays": "France",
        "ville": "Ville de départ",
        "titre": "Notre première étape",
        "texte": "Raconter ici les événements de la journée.",
        "photos": [
          {
            "src": "/photos/premiere-etape/photo-01.webp",
            "alt": "Description accessible de la photo",
            "legende": "Une légende facultative"
          }
        ],
        "videos": []
      }
    ]

Ce contenu est un EXEMPLE de structure, pas un voyage déjà publié. Le vrai fichier JSON commence vide.

- Images publiques : ajouter les fichiers optimisés dans public/photos/ (jusqu'à ce qu'on configure Cloudflare R2). Les chemins dans JSON commencent par /photos/.
- Vidéos : ajouter un objet dans videos avec "url" (lien YouTube complet) et "titre". Les formats watch, youtu.be, shorts et live sont pris en charge.
- Les pages de pays, le journal et la galerie se mettent à jour automatiquement lors de la compilation.
- Une étape par date/ville fonctionne bien au départ ; chaque slug doit être unique.
- Retirer les métadonnées GPS des photos publiques et garder une sauvegarde des originaux.
- Ne jamais ajouter d'images ou de liens privés : ils pourraient être visibles et indexés.

## Mise en ligne : Cloudflare Workers

Le Worker cible s'appelle **voyage**. Son URL de production est
https://voyage.site-ready.workers.dev/ (à confirmer après le premier déploiement réussi).
Le dossier `dist/` généré par Astro est servi comme assets statiques ; aucune base
de données ni aucun secret n'est nécessaire au fonctionnement actuel.

Le dépôt contient `wrangler.jsonc` (nom, assets, URL workers.dev et Previews).
Depuis **Cloudflare > Workers & Pages > voyage > Settings > Builds** :

1. Connecter le dépôt GitHub `rafa-create/voyage` au Worker existant, s'il ne l'est pas déjà.
2. Définir le dossier racine sur la racine du dépôt et la branche de production sur `main`.
3. Définir la commande de build sur `npm run build` (inclut la validation des étapes).
4. Définir la commande de déploiement sur `npx wrangler deploy`.
5. Activer les Preview Builds pour les branches secondaires, avec `npx wrangler preview`.
6. Vérifier dans l'historique des déploiements que le dernier build est réussi, puis ouvrir l'URL de production.

Les Worker Previews nécessitent Wrangler 4.135.0 ou ultérieur : la dépendance du projet
est maintenant ajustée. Les environnements de Preview ne publient pas sur la production.
L'URL `*-voyage.site-ready.workers.dev` est un **modèle d'URL** : une URL réelle est créée
lorsqu'une Preview est effectivement déployée. Cloudflare ajoute un en-tête de non-indexation
aux URLs Preview sur `workers.dev`.

### Domaine personnalisé (facultatif)

En attendant de choisir un domaine, conserver l'URL workers.dev ci-dessus.
Pour ajouter un domaine déjà géré dans Cloudflare : ouvrir **voyage > Domains >
Custom Domains and Routes > Add Domain**, puis saisir le domaine exact souhaité.
Ne pas inventer de DNS ni écraser un domaine utilisé par un autre site.

### Avant le départ

- Laisser `src/data/etapes.json` vide tant qu'aucune étape réelle n'est à publier.
- Préparer une première étape avec date, pays, ville, titre et récit ; garder un slug unique.
- Optimiser les photos publiques (WebP si possible), retirer les métadonnées GPS et vérifier les droits à l'image.
- Publier les souvenirs **après** le passage dans un lieu plutôt qu'en temps réel si l'itinéraire est privé.
- Lancer `npm run validate` et `npm run build` avant de fusionner les changements.
- Vérifier navigation, rendu mobile, liens, images, YouTube et page introuvable en production.
- Garder les fichiers originaux et les sauvegardes de photos ailleurs que dans ce dépôt public.

Le site est public et statique. Il n'a pas de connexion privée ni de formulaire
d'administration ; publier une étape signifie faire un commit GitHub et laisser
Cloudflare reconstruire le site. Une Preview doit être testée avant de publier en production.

**Alternative non utilisée :** GitHub Pages, avec `GITHUB_PAGES=true` pour le préfixe
`/voyage/`. Ne pas activer les deux hébergements par erreur.


## Photos publiques dans Cloudflare R2

Un seul binding R2 est actif : `PHOTOS_PUBLIQUES`, lié au bucket
`voyage-photos` dans `wrangler.jsonc`. Wrangler crée automatiquement
cette liaison lors du déploiement. Le bucket **privé** `voyage-photos-prive`
ne doit pas être lié à ce Worker public tant que l'authentification et les
autorisations ne sont pas implémentées.

Pour ajouter une photo publique :

1. Dans Cloudflare > R2 > `voyage-photos` > Objects, téléverser le fichier
   (exemple de clé : `japon/tokyo-01.webp`).
2. Dans `src/data/etapes.json`, référencer son URL locale via
   `"src": "/media/japon/tokyo-01.webp"`.
3. Valider et publier le changement sur GitHub. Le site affiche alors la photo
   à `https://voyage.site-ready.workers.dev/media/japon/tokyo-01.webp`.

Le code `worker/index.js` n'autorise que la lecture des images publiques
(`GET` et `HEAD`). Il ne permet ni d'écrire ni de lister les fichiers.
Ne pas mettre de photo privée dans ce bucket. Conserver les originaux ailleurs.

## Évolutions prévues

1. Publier des photos et des textes publics depuis ChatGPT, via des modifications du dépôt.
2. Déplacer les nouvelles photos publiques volumineuses dans Cloudflare R2 lorsque cela devient utile.
3. Ajouter plus tard un vrai espace privé avec Cloudflare Access et un stockage R2 **non public** : ne pas simuler la sécurité avec de simples pages cachées.
4. Envisager une IA intégrée uniquement si les quotas gratuits disponibles suffisent.

Pas de clé d'API ni de secret dans ce dépôt.
