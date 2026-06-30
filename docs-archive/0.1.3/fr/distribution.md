---
icon: lucide/package
---

# Distribution

La distribution transforme vos tokens en vrais fichiers de sortie (variables CSS, SCSS,
TypeScript, JSON) via [Style Dictionary](https://styledictionary.com). Ouvrez-la depuis
l'**icône paquet** dans le header.

Deux chemins : laisser l'assistant **configurer la conversion** pour vous, ou **relier
un build existant** que vous avez déjà.

## Configurer la conversion (assistant)

Un assistant en trois étapes : **Variants**, **Outputs**, **Build & test**.

1. **Variants** : confirmez les variantes (modes / fichiers de thème) détectées par
   collection.
2. **Outputs** : choisissez quoi générer et où. Pour chaque cible vous définissez un
   format, un chemin de destination, un préfixe optionnel, et une stratégie de rendu par
   collection (sélecteurs CSS, media queries, fichiers séparés, ou un seul fichier
   plat).
3. **Build & test** : lancez un **Test build** (en bac à sable, rien n'est écrit) et
   relisez le rapport, puis **Save build** pour écrire le script et un script npm dans
   votre projet.

![Assistant de distribution, étape Outputs](assets/screenshots/distribution-outputs.webp)

### Fichiers de sortie & téléchargements

Le rapport de build regroupe les fichiers générés dans des sections repliables **par
format** (CSS, SCSS, Less, JavaScript / TypeScript, JSON), chacune indiquant son nombre
de fichiers et sa taille totale. Repliez un groupe pour vous concentrer sur le reste.

Vous pouvez télécharger le résultat sans rien écrire dans votre projet :

- **⬇ .zip** sur un groupe télécharge uniquement les fichiers de ce format (chacun rangé
  sous son target).
- **⬇ Download all (.zip)** télécharge tout, organisé par format puis par target.

![Rapport de build, fichiers groupés par format avec téléchargement zip](assets/screenshots/distribution-build.webp)

## Vue d'ensemble

Une fois un pipeline enregistré, la fenêtre Distribution affiche son résumé : les
sources et leurs variantes, les cibles et destinations, et un bouton **Test build**.
Utilisez **Edit** pour rouvrir l'assistant.

![Vue d'ensemble de la distribution](assets/screenshots/distribution.webp)

!!! note "Test build vs. build réel"

    **Test build** lance la conversion dans un bac à sable et n'écrit jamais dans votre
    projet. C'est le script npm enregistré (par ex. `npm run build:tokens`) qui écrit
    réellement les fichiers de sortie.

## Relier un build existant

Vous avez déjà une config Style Dictionary (ou autre) et une commande de build ?
Choisissez **I already have my config** pour pointer l'outil vers votre fichier de
config et votre commande. Lancer un build relié exécute votre vraie commande et écrit
ses fichiers de sortie sur le disque.
