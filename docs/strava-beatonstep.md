# Relier Strava à Voyage via BeatOnStep

Les deux projets conservent leurs propres interfaces ; aucune connexion OAuth supplémentaire n'est créée.

## Configuration (une seule fois)

1. Dans les paramètres Cloudflare du Worker `beatonstep-website`, ajouter un **Secret** `VOYAGE_BRIDGE_KEY` avec une valeur aléatoire de 40 caractères ou plus.
2. Dans les paramètres du Worker `voyage`, ajouter un **Secret** `VOYAGE_BRIDGE_KEY` avec **exactement la même valeur**.
3. S'assurer que les deux Workers utilisent les dernières versions déployées. Ne pas placer la clé dans GitHub.
4. Depuis BeatOnStep, le compte Strava du propriétaire doit déjà être connecté et autorisé à lire les activités (`activity:read`). L'identifiant du propriétaire par défaut est celui du profil Strava choisi pour Voyage ; il peut être remplacé dans BeatOnStep par la variable `VOYAGE_STRAVA_ATHLETE_ID`.
5. Ouvrir la page publique `/defi/`, déplier « Mes courses et tracés GPS » en étant connecté en tant qu'administrateur Cloudflare Access. Les courses et les tracés sont alors chargés uniquement dans cette session.

L'endpoint de BeatOnStep `/api/voyage/strava/*` est verrouillé sans clé de liaison et ne transmet jamais de jeton Strava.

## Affichage

Les widgets Strava officiels restent publics et repliés par défaut. L'historique API et ses cartes MapLibre restent accessibles uniquement à l'administrateur authentifié. Les données API ne sont pas mises en cache par Voyage ni publiées sur la page accessible aux visiteurs, conformément aux restrictions d'affichage Strava applicables.

Les courses affichées sont les dix courses les plus récentes retournées par l'intégration BeatOnStep. Les parcours peuvent ne pas être disponibles pour certaines activités ou selon les autorisations Strava. Il ne s'agit pas d'une localisation en temps réel.

Le calendrier public des journées complètes utilise toujours les entrées Strava saisies/publiées depuis Voyage : le flux API privé ne modifie pas automatiquement ce calendrier public.
