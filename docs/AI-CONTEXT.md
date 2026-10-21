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
