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
- Les nouvelles activités détectées sont copiées dans l'archive personnelle R2 : résumé, date de départ, sport, distance, durée et, lorsque disponible, un tracé simplifié. L'import est limité à huit nouveaux résumés par page et quelques parcours par passage, pour respecter le forfait gratuit Cloudflare. Le rattrapage complet peut donc demander plusieurs synchronisations (toutes les deux heures).
- Les copies sont enregistrées dans le bucket R2 privé, avec déduplication selon l'ID de l'activité. Seules les activités dont la visibilité à la source est `everyone` peuvent apparaître dans le journal public. La page administration indique le total archivé.
- Cette copie API n'est **pas** le FIT/GPX original Garmin/Strava : elle comporte au plus 120 points GPS. L'import GPX manuel conserve l'original, et reste disponible pour compléter l'archive.

## Public

- Le journal public et la carte grand public utilisent les fichiers GPX personnels explicitement publiés, les entrées manuelles existantes et les copies d'activités marquées `everyone` par le propriétaire à la source. Les données réservées aux abonnés, privées ou de visibilité inconnue ne sont jamais publiées. Les copies sources restent toutes conservées dans le bucket privé.
- Les widgets officiels Strava restent accessibles mais repliés.
- Chaque journée retient la dernière activité et la dernière partie Chess.com Rapid ; la carte principale accueille toutes les activités GPS et les photos publiques.
- La publication de données issues de l'API, ainsi que la durée de conservation de ces copies API, devront être revues vis-à-vis des conditions du fournisseur avant diffusion publique. Le fait d'être propriétaire des activités ne supprime pas les conditions d'utilisation de l'API.

## Validation

Après déploiement des deux Workers : ouvrir `/admin/defi/`, regarder « Activités détectées » et vérifier que le total des copies privées R2 augmente. Un échec du pont privé ou une connexion sportive absente affiche une erreur, sans détruire les archives existantes.
