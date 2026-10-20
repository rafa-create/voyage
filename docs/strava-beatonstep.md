# Liaison des activités BeatOnStep → Voyage

Les activités sont enregistrées soit avec une montre Garmin, puis synchronisées vers Strava, soit directement avec Strava. BeatOnStep conserve les jetons OAuth ; aucun jeton n'est transmis au navigateur ou au Worker Voyage.

## Configuration

- Le même secret Cloudflare `VOYAGE_BRIDGE_KEY` (40 caractères minimum) doit exister dans les Workers `beatonstep-website` et `voyage`.
- La connexion BeatOnStep de l'athlète doit être active avec `activity:read`.
- Le Worker BeatOnStep doit avoir la version déployée incluant `recentVoyageActivities`, qui expose toutes les disciplines via le pont privé. Sans ce déploiement, les anciennes versions ne renvoient que les courses.
- Le Worker Voyage doit aussi être déployé avec sa nouvelle configuration de cron (toutes les deux heures).

## Chargement et copies personnelles

- L'ouverture de `/defi/` déclenche une synchronisation serveur, limitée à une requête par dix minutes. Le cron vérifie également toutes les deux heures.
- Les 100 premières activités sont lues à chaque synchronisation ; une pagination supplémentaire (jusqu'à dix pages de 100) permet le rattrapage des activités des 90 derniers jours au fil des passages, y compris si elles ne sont arrivées sur le compte sportif qu'un mois après leur réalisation. Le cache API des activités récentes conserve seulement les sept derniers jours.
- Les nouvelles activités détectées sont copiées dans l'archive personnelle R2 : résumé, date de départ, sport, distance, durée et, lorsque disponible, un tracé GPS complet lorsque Strava fournit son flux. L'import est limité à huit nouveaux résumés par page et quelques parcours par passage, pour respecter le forfait gratuit Cloudflare. Le rattrapage complet peut donc demander plusieurs synchronisations (toutes les deux heures).
- Les copies sont enregistrées dans le bucket R2 privé, avec déduplication selon l'ID de l'activité. À la demande expresse du propriétaire, la publication automatique de **toutes ses copies d'activités** est activée par défaut, y compris celles dont la visibilité d'origine est privée ou non renseignée. La commande « Afficher mes activités dans le journal et sur la carte publics » dans `/admin/defi/` permet de tout masquer instantanément **sans supprimer les archives**. Les GPX personnels marqués privés ne sont pas concernés.
- Cette copie API n'est **pas** le FIT/GPX original Garmin/Strava : elle conserve le flux GPS de l'API (jusqu'à 100 000 points), avec trois résolutions dérivées pour la carte : aperçu (120 points), détail (5 000 points) et complet (tous les points reçus). L'import GPX manuel conserve l'original, et reste disponible pour compléter l'archive.

## Public

- Le journal et la carte publics affichent toutes les copies de l'athlète importées automatiquement dès lors que la publication globale est activée. Le réglage de la plateforme d'origine **ne commande pas** cette publication, conformément au choix explicite du propriétaire. Cela peut exposer des activités privées et leurs traces GPS : la commande d'administration permet de masquer toutes les copies à tout moment. Les fichiers GPX importés manuellement gardent leur visibilité propre. Toutes les copies restent dans le bucket R2 privé, la page publique n'en servant qu'une vue filtrée.
- Les widgets officiels Strava restent accessibles mais repliés.
- Chaque journée retient la dernière activité et la dernière partie Chess.com Rapid ; la carte principale accueille toutes les activités GPS et les photos publiques.
- La publication de données issues de l'API, ainsi que la durée de conservation de ces copies API, devront être revues vis-à-vis des conditions du fournisseur avant diffusion publique. Le fait d'être propriétaire des activités ne supprime pas les conditions d'utilisation de l'API.

## Validation

Après déploiement des deux Workers : ouvrir `/admin/defi/`, regarder « Activités détectées » pour vérifier « N archivées dans R2 · N dans le journal public · N parcours GPS disponibles ». Par défaut les N archives auto doivent toutes être publiées. Ouvrir ensuite `/defi/` et appuyer sur « Actualiser » : une partie rapide et la dernière activité de la même date doivent donner 2/2 ; la carte affiche toutes les activités avec les traces GPS disponibles. Les copies R2 ne sont pas effacées lors des visites. Un échec du pont privé ne détruit pas les archives existantes.


## Isolation de BeatOnStep

Dans le dépôt `rafa-create/beatonstep-website`, seuls les deux fichiers du Worker sont concernés :
- `worker/index.js` reconnaît le chemin réservé `/api/voyage/strava/*` ;
- `worker/strava.js` fournit la passerelle `voyageStravaInternal`, avec vérification du secret commun, lecture des activités et de leurs tracés, et pagination autorisée.

Aucune page, bouton, nom de Voyage ou fonctionnalité visible n'a été ajouté à l'interface BeatOnStep. La méthode historique `recentRuns` et la méthode normale de lecture des parcours conservent leur contrat ; la tolérance aux flux GPS sans temps est réservée au pont privé.

## Interface publique Voyage

Dans `/defi/`, on voit directement uniquement le bilan, la journée du jour et les autres journées. Chaque objectif dispose d'un volet replié :
- un clic sur « Échecs » affiche la partie rapide, la progression ELO **jusqu'à la journée sélectionnée** et le lien vers la partie originale ;
- un clic sur « Activité physique » affiche toutes les activités de cette journée, les liens d'origine et le parcours GPS zoomable ou plein écran s'il existe ;
- les widgets restent facultatifs et repliés.

Le classement et les traces ne sont pas chargés dans une grande section séparée en permanence.

## GitHub Actions

Le workflow `.github/workflows/check.yml` est temporairement limité à `workflow_dispatch` : il ne consomme plus automatiquement de minutes à chaque commit sur `main`. Lorsqu'un quota sera à nouveau disponible, on pourra réactiver le contrôle automatique à chaque push.
