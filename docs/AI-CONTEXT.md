# Règles d'architecture pour les évolutions assistées par IA

## Carte interactive de la page « IR »

**Règle impérative : toute décision de déplacement ou de zoom de la caméra doit passer par une seule fonction centralisée dans `src/components/CarteItineraire.astro` : `requestDayCamera`.** Ne pas ajouter de `fitBounds`, `easeTo`, `flyTo` ou autre déplacement de caméra dans les gestionnaires de boutons, le chargement des traces ou le rendu des marqueurs.

- Le chargement initial sélectionne hier si des souvenirs y existent, sinon la dernière journée passée documentée.
- Les boutons précédent/suivant, « Hier », le sélecteur de date et les événements de sélection de journée demandent tous un cadrage via le même point d'entrée.
- La fonction centralisée cadre d'abord le parcours GPS complet de la journée lorsqu'il est disponible ; sinon elle englobe les marqueurs de souvenirs de cette journée.
- Si la journée n'a pas de coordonnées exploitables, elle utilise l'étape datée correspondante, puis l'itinéraire global comme repli.
- Les demandes de cadrage asynchrones doivent être invalidées lorsqu'une sélection plus récente arrive, afin qu'une réponse réseau tardive ne déplace pas la carte vers une ancienne journée.
- Le chargement et le style des tracés peuvent dessiner/mettre à jour les couches, mais ne doivent pas déplacer la caméra.
- Toute nouvelle interaction qui nécessite un zoom doit appeler la fonction centralisée plutôt que manipuler directement la caméra.
- Après toute modification, vérifier l'arrivée sur la page IR, précédent/suivant, « Hier », sélection directe d'une date, lien « Voir sur la carte », jour avec parcours GPS, jour avec plusieurs photos et jour sans coordonnées. Vérifier également que les animations précédentes ne reprennent pas le contrôle après un changement de date.

## Carte interactive — sélection de journée et caméra (correctif validé)

- Le correctif a été validé manuellement par l'utilisateur : le zoom initial fonctionne, et après la correction les commandes précédent/suivant et la sélection d'une date refonctionnent.
- Dans `src/components/CarteItineraire.astro`, `updateSelectedDay` est le point d'entrée de la sélection : il doit mettre à jour `selectedDay` et `document.documentElement.dataset.voyageDay`, actualiser le style des marqueurs/tracés puis demander le cadrage via `requestDayCamera`.
- Ne pas lancer une seconde animation de caméra depuis le même gestionnaire de sélection : cela crée des animations concurrentes et peut annuler le cadrage attendu.
- Les états utilisés par les événements de sélection (notamment l'état des tracés) doivent être déclarés avant l'enregistrement/traitement des événements, pour éviter une sélection précoce pendant le chargement.
- Lors de toute modification de la navigation par jour, tester le zoom initial, précédent/suivant, le sélecteur de date et les événements `voyage:jour`, puis vérifier que les tracés restent corrects.
- Correctif implémenté sur `main` dans le commit `c0a3f811fb78695c2566fbb7742d8eea46ff5ae8`. La validation utilisateur confirme le comportement fonctionnel ; ne pas prétendre qu'un build ou un déploiement Cloudflare a été vérifié sans contrôle distinct.

## Photos originales et métadonnées

- L'import admin doit envoyer le fichier d'origine sans réencodage ni redimensionnement, afin de conserver les dimensions, la qualité et les métadonnées EXIF/GPS.
- Les dates et coordonnées utilisées par le classement doivent continuer à être extraites et enregistrées séparément pour les API et la carte.
- Vérifier que les URL de galerie et de téléchargement pointent vers le fichier original stocké, et non vers une miniature.
- La conversion qui retire les métadonnées EXIF peut être utilisée lors d'une action explicite de publication d'une photo privée vers un espace public, pour éviter de divulguer involontairement un emplacement privé. Ne pas réutiliser ce traitement dans le flux normal d'import original.
- Tester avec des JPEG d'iPhone haute résolution et un format HEIC/HEIF accepté par l'interface ; contrôler les dimensions, le type MIME, la lecture dans la galerie et la présence des métadonnées après téléchargement.

## Page « Défi » — rafraîchissement prioritaire et synchronisation de fond
### Comportement validé par l'utilisateur
- À l'ouverture de `/defi`, afficher d'abord le cache public disponible pour rendre la page rapidement, puis demander immédiatement le rafraîchissement ciblé du jour. L'utilisateur a confirmé que ce comportement fonctionne.
- Le rafraîchissement prioritaire met à jour les parties du jour : échecs du mois courant uniquement (l'API Chess.com expose les archives par mois) et activités sportives du jour uniquement. Il doit préserver les parties d'échecs plus anciennes déjà en cache.
- Le rafraîchissement ciblé du sport utilise le fuseau configuré, n'importe que les activités datées du jour, limite l'import à trois activités et ne récupère pas les géométries de parcours dans cette passe.
- Ensuite, tant que la page reste ouverte, le navigateur déclenche une demande de synchronisation de fond toutes les 60 secondes, puis relit le cache environ 10 secondes après la demande. La synchronisation de fond traite les données plus larges; elle répond rapidement au navigateur et continue côté Worker.
- Le rafraîchissement ciblé possède un garde-fou dédié d'une minute. Les synchronisations amont gardent également leurs propres limites de fréquence; ne pas contourner ces protections pour forcer un rafraîchissement chaque minute.
- Les rafraîchissements de cache ne doivent pas fermer ni perturber les détails d'un défi que l'utilisateur a déjà ouverts.
- Les erreurs de synchronisation des échecs et du sport sont isolées : l'échec d'une source ne doit pas empêcher l'autre de se mettre à jour.

### Endpoints et fichiers à préserver
- `src/pages/defi.astro` orchestre le chargement : lecture du cache d'abord, rafraîchissement du jour ensuite, puis boucle de synchronisation de fond.
- `GET /api/public/defi?aujourdhui=1` attend le rafraîchissement ciblé du jour et renvoie les données actualisées.
- `GET /api/public/defi?arriere-plan=1` démarre `freshPublicChallenge(env)` en arrière-plan via `ctx.waitUntil` et renvoie immédiatement un état d'acceptation.
- `GET /api/public/defi?statut=1` lit le cache sans déclencher une synchronisation amont.
- `worker/defi.js` contient `freshTodayChallenge` et `syncChess(..., { todayOnly: true })`; `worker/sport-sync.js` prend en charge `todayOnly` et le fuseau horaire.
- Ne pas remplacer le rafraîchissement ciblé par une synchronisation complète au chargement : cela ralentirait l'affichage et multiplierait les appels externes. Garder la synchronisation complète en arrière-plan et les tâches planifiées existantes.
- Vérification : l'utilisateur a confirmé le fonctionnement de la priorité du jour suivie de la synchronisation de fond. Un test automatisé a été ajouté pour le périmètre du jour, mais ne pas affirmer que la suite de tests ou le build a été exécuté sans l'avoir réellement fait. Ne pas déployer sans accord explicite.
## Mode privé du site — liste blanche d’e-mails

- Le réglage est stocké dans R2 sous `__meta/site-access.json`, avec `mode: "open" | "restricted"` et une liste `emails` normalisée en minuscules.
- L’administration se fait depuis `/admin/`, panneau « Qui peut consulter Voyages ? ». Une adresse par ligne est acceptée; les doublons sont éliminés et la limite est de 100 adresses.
- En mode `restricted`, les pages publiques et leurs API passent par la session du site. Une personne sans session est redirigée vers `/connexion/`; la connexion vérifie seulement que l’adresse saisie figure dans la liste blanche (ou correspond à `ADMIN_EMAIL`). Aucun code ni mot de passe n’est envoyé ou demandé.
- La session utilise un jeton aléatoire dans un cookie `HttpOnly; Secure; SameSite=Lax`, valable 7 jours. Seul le hash SHA-256 du jeton est utilisé comme clé d’un enregistrement de session dans R2. La liste blanche est revalidée à chaque requête protégée : retirer une adresse révoque donc ses sessions.
- `GET /api/public/site-access/status`, `POST /api/public/site-access/login` et `POST /api/public/site-access/logout` gèrent l’état, la connexion et la déconnexion. Les sessions e-mail ne donnent aucun accès aux routes d’administration, aux albums privés ou aux API privées : celles-ci continuent d’exiger Cloudflare Access/JWT.
- Les ressources statiques de construction (`/_astro/`, CSS, JS, polices et médias statiques génériques) restent accessibles pour que la page de connexion et les styles puissent charger. Les photos servies via `/media/` restent soumises au contrôle d’accès.
- Limite explicitement acceptée par le propriétaire : l’adresse e-mail n’est pas vérifiée. Une personne connaissant une adresse autorisée peut l’usurper pour voir le site public. Ne jamais présenter ce mécanisme comme une preuve d’identité ou comme une authentification forte.
- Fichiers principaux : `worker/auth.js`, `worker/index.js`, `src/pages/connexion.astro`, `src/pages/admin/index.astro`, `src/layouts/Base.astro`, test `tests/site-access-auth.test.mjs`.
- Ne pas déployer automatiquement. Le code et le test ont été ajoutés, mais les tests et le build ne sont pas déclarés validés tant qu’ils n’ont pas été exécutés.
