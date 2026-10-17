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

## Galerie de test et photos à classer

Le fichier `src/data/photos-a-classer.json` contient les références vers les photos
publiques téléversées dans le bucket `voyage-photos`. Elles apparaissent dans la
galerie et dans le compteur de l'accueil, mais **ne créent aucune étape ni aucun pays fictif**.

Chaque photo contient un chemin `/media/nom-du-fichier.jpeg`, un texte alternatif
et une légende. Les noms de fichiers dans R2 sont sensibles aux majuscules.
Lorsque l'on connaît la date, le pays et le lieu, déplacer la référence correspondante
dans `src/data/etapes.json` et la retirer de `photos-a-classer.json` pour éviter
les doublons. Les photos doivent être publiques et non sensibles.

## Connexion privée et interface d'administration (à activer dans Cloudflare)

Le site contient maintenant trois pages :
- `/connexion/` : entrée publique vers le formulaire Cloudflare Access (code e-mail).
- `/espace/` : galerie de photos privées réservée aux proches.
- `/admin/` : choisir l'étape actuelle, créer des étapes et téléverser des photos dans R2.

**Sécurité fermée par défaut** : sans jeton Cloudflare Access signé et variables de configuration, toutes les routes privées renvoient une erreur ; cela ne signifie pas que les droits sont configurés.

1. Dans Cloudflare Zero Trust > Access controls > Applications, créer **une application self-hosted** associée à `voyage.site-ready.workers.dev` avec **les chemins protégés** :
   - `/espace` et `/espace/*`
   - `/admin` et `/admin/*`
   - `/api/prive/*`
   - `/media-prive/*`
   Les autres chemins, dont `/`, `/galerie/` et `/connexion/`, restent publics.
2. Dans la politique Allow, ajouter **uniquement** les adresses e-mail des invités (y compris celle de l'administrateur). Ajouter une méthode de connexion **One-time PIN** par e-mail.
3. Dans **Workers & Pages > voyage > Settings > Variables and Secrets**, définir :
   - `ACCESS_TEAM_DOMAIN` = URL complète `https://NOM-EQUIPE.cloudflareaccess.com`
   - `ACCESS_AUD` = **Application Audience (AUD)** de cette unique application Access
   - `ADMIN_EMAIL` = adresse e-mail complète du propriétaire (l'adresse que tu utilises pour te connecter).
   Ne pas committer ces valeurs dans le dépôt public. Aucun mot de passe ni clé R2 n'est nécessaire.
4. La configuration `wrangler.jsonc` attache `PHOTOS_PRIVEES` au bucket **voyage-photos-prive**, sans activer ses URL publiques.
5. Choisir une durée de session Access (par exemple 7 jours). Une session n'est pas permanente : il faudra se reconnecter après expiration.
6. Tester : sans connexion, `/espace/` et `/media-prive/*` doivent être bloqués ; invité connecté = galerie privée mais pas admin ; e-mail administrateur = accès à `/admin/`.

Le Worker **vérifie cryptographiquement le JWT Access** (signature, audience et émetteur) et compare l'adresse à `ADMIN_EMAIL` pour autoriser les modifications. La protection des routes en amont dans Access reste importante. **Ne jamais protéger le Worker entier** : cela rendrait le site public inaccessible.

### Publication et classement

L'admin sélectionne une étape (étape active sélectionnée par défaut), puis ajoute plusieurs photos. Un fichier va dans `voyage-photos/etapes/SLUG/` s'il est public, ou `voyage-photos-prive/etapes/SLUG/` s'il est privé. Chaque objet R2 mémorise son étape dans ses métadonnées. Les galeries récupèrent les nouvelles images depuis l'API Worker sans déploiement GitHub ni D1. Le site limite chaque image à 12 Mo.

Les étapes créées depuis l'admin sont enregistrées dans les métadonnées du bucket privé et accessibles publiquement par leur page d'étape, la carte étant mise à jour depuis l'API publique. Les images du bucket privé ne sont jamais publiées par cette API.

**Important** : un transfert réalisé directement dans le tableau de bord R2 n'est **pas** encore automatiquement classé ; seuls les transferts effectués depuis l'admin le sont. Pour automatiser les changements faits depuis le tableau de bord R2, on pourra plus tard configurer R2 Event Notifications et Cloudflare Queues (vérifier les limites gratuites). Les albums privés sont communs à tous les invités autorisés pour l'instant ; une autorisation par album serait une étape supplémentaire.

## Évolutions prévues

1. Publier des photos et des textes publics depuis ChatGPT, via des modifications du dépôt.
2. Déplacer les nouvelles photos publiques volumineuses dans Cloudflare R2 lorsque cela devient utile.
3. Ajouter plus tard un vrai espace privé avec Cloudflare Access et un stockage R2 **non public** : ne pas simuler la sécurité avec de simples pages cachées.
4. Envisager une IA intégrée uniquement si les quotas gratuits disponibles suffisent.

Pas de clé d'API ni de secret dans ce dépôt.
