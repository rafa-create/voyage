# Intégration Strava entre BeatOnStep et Voyage

Les deux sites utilisent le même compte Strava. BeatOnStep reste la source des jetons OAuth stockés sur son Worker ; l'interface BeatOnStep est inchangée.

## Activation Cloudflare

- Ajouter le même secret `VOYAGE_BRIDGE_KEY` (minimum 40 caractères) dans `beatonstep-website` et `voyage`, et déployer les deux Workers.
- BeatOnStep doit avoir une connexion Strava active autorisant `activity:read`.
- BeatOnStep peut préciser l'athlète dans `VOYAGE_STRAVA_ATHLETE_ID`, sinon le profil déjà configuré par défaut est utilisé.
- Les secrets restent dans Cloudflare, jamais dans le dépôt GitHub.

## Synchronisation publique

- `/api/public/defi` déclenche au maximum toutes les dix minutes la synchronisation des dernières courses via le pont privé.
- Seules les activités dont la visibilité renvoyée par Strava est exactement `everyone` sont incluses, jamais les sorties privées ou réservées aux abonnés.
- La liste des dix sorties les plus récentes se trouve dans R2. Elle inclut les sorties antérieures à la date de début du défi pour la carte de localisation historique.
- Sur la page `/defi/`, chaque journée de défi présente **la dernière** course publique de la date et **la dernière** partie d'échecs, sans cumul d'activités.
- Pour chaque course publique récente, `/api/public/defi/parcours/:id` retourne un tracé simplifié : uniquement pour les IDs de courses présentes dans la liste publique ; les extrémités du tracé sont réduites d'environ 7 % lorsqu'il y a assez de points.
- La carte MapLibre utilise les tuiles OpenFreeMap.
- Les widgets Strava officiels sont repliés par défaut en complément du journal.

## Échecs / ELO

Les parties récentes sont synchronisées avec l'API publique Chess.com, au maximum toutes les deux minutes lors d'une visite. Le dernier résultat terminé dans une journée est retenu.

Les classements sont lus depuis les statistiques et les archives Chess.com ; on ne compare que les parties de la même cadence pour les variations. Si les données sont insuffisantes, l'interface affiche un tiret plutôt qu'une variation inventée.

## Limites et publication

Les parcours GPS sont visibles à tout visiteur du carnet. Cela peut révéler la localisation de l'athlète ; les débuts et fins sont atténués, mais le tracé reste informatif. Les utilisateurs doivent veiller à configurer leurs zones de confidentialité sur Strava.

Les données partagées via l'API restent soumises aux conditions Strava en vigueur, indépendamment du fait que l'athlète soit propriétaire du compte et du partage d'une application OAuth avec BeatOnStep.

L'API ne représente pas une géolocalisation en direct. Si le pont Strava ne répond pas, les dernières courses enregistrées restent affichées et le défi Chess.com continue de fonctionner.
