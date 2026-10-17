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

## Mettre en ligne

**Option conseillée au départ : Cloudflare Pages**. Connecter le dépôt GitHub, branche main, framework Astro, commande de build **npm run build**, répertoire de sortie **dist**, version Node 22. Le site est alors publié sur une adresse pages.dev, sans serveur à gérer.

**Alternative GitHub Pages** : exécuter le build avec la variable GITHUB_PAGES=true afin de générer les liens sous /voyage/. Déployer dist avec une action GitHub Pages. L'URL cible serait https://rafa-create.github.io/voyage/. Les deux plateformes ne sont pas nécessaires à la fois.

## Évolutions prévues

1. Publier des photos et des textes publics depuis ChatGPT, via des modifications du dépôt.
2. Déplacer les nouvelles photos publiques volumineuses dans Cloudflare R2 lorsque cela devient utile.
3. Ajouter plus tard un vrai espace privé avec Cloudflare Access et un stockage R2 **non public** : ne pas simuler la sécurité avec de simples pages cachées.
4. Envisager une IA intégrée uniquement si les quotas gratuits disponibles suffisent.

Pas de clé d'API ni de secret dans ce dépôt.
