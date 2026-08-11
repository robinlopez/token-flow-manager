---
icon: lucide/layout-template
---

# Modèles de démarrage

Nul besoin d'un projet de tokens existant pour utiliser Token Flow Manager. Lancez-le sans
chemin : la carte **Open a project** propose une seconde entrée en bas, **No project yet?
Start from a template**. Au clic, la carte glisse vers le sélecteur de modèles, où vous
choisissez un design system et un dossier ; une structure de tokens DTCG complète est
écrite sur le disque puis ouverte. Le bouton **‹** ramène en arrière.

C'est le chemin le plus rapide vers une **source de vérité** que vous pourrez committer
dans un dépôt, avec collections, modes et alias déjà en place.

## Les quatre modèles

| Modèle | Origine | Ce que vous obtenez |
| --- | --- | --- |
| **Tailwind CSS v4** | Officiel | La palette de couleurs complète (50–950 sur toutes les teintes) et les échelles métriques : spacing, radius, épaisseurs de bordure, opacité, flou, breakpoints, containers, tailles / graisses / interlignage / interlettrage de police, plus les styles de texte de la typographie. 2 collections, 434 variables. |
| **Material Design 3** | Officiel | Le système de couleurs en 32 schémas (clair et sombre, chacun en contraste moyen et élevé, plus 13 thèmes d'accent), les state layers et les rôles add-on, la typescale Baseline, deux thèmes de police et l'échelle de formes. 4 collections, 304 variables. |
| **Semantic Functional DS** | Communauté | Un système multi-marques à nommage sémantique strict et familles d'intention fonctionnelle (actions, form, informative, navigation, table) : primitives sur 3 marques, sémantiques en Light / Dark, plus metrics, typography, responsive, utils, breakpoints et transitions. 8 collections, 467 variables. |
| **Simple Design System** | Communauté | Le starter populaire de la Figma Community : Color Primitives, Color (SDS Light / SDS Dark), Typography Primitives, Typography, Size et Responsive. Le point de départ le plus doux. 6 collections, 347 variables. |

Chaque ligne affiche son nombre de collections et de variables avant tout engagement, et la
boîte de dialogue détaille chaque collection avec son propre compte de variables et de
modes.

## Créer un projet

1. Cliquez sur **Start from a template** en bas de la carte *Open a project*, puis
   choisissez un modèle dans la liste. Une boîte de dialogue s'ouvre avec la description
   complète et ce qui sera écrit sur le disque.
2. Choisissez la destination avec **Browse…** (la boîte de dialogue native, puisque le
   serveur tourne sur votre machine) ou collez un chemin.
3. Changez au besoin le nom du **sous-dossier**. Il vaut `design-tokens` par défaut ;
   laissez-le vide pour écrire directement dans le dossier choisi.
4. Laissez **Set up distribution right after** cochée pour enchaîner sur le configurateur
   de [Distribution](distribution.md) dès l'ouverture du projet : un jeu de tokens tout
   neuf n'a pas encore de build.
5. **Create project**.

Les fichiers sont écrits, le projet s'ouvre, et il rejoint vos projets récents comme
n'importe quel autre.

!!! note "Rien n'est écrasé par accident"

    Si la destination contient déjà un fichier de même nom, rien n'est écrit : la boîte de
    dialogue nomme les fichiers en conflit et propose un bouton **Overwrite them**
    explicite.

## Ce qui arrive sur le disque

Un dossier plat, sans config de build, sans `package.json`, rien à installer :

```
design-tokens/
├── manifest.json              # l'organisation : collections → modes → fichiers
├── tailwindcss-colors.json    # tokens DTCG
├── tailwindcss-metrics.json
└── styles.tokens.json         # styles de texte + d'effet Figma (si le modèle en a)
```

`manifest.json` est la pièce décisive. C'est la source de vérité de l'organisation que lit
le tableau de bord (et elle reste interchangeable avec le plugin Figma) : un dossier généré
s'ouvre donc avec ses **collections et ses colonnes de modes déjà justes**, sans dépendre
de l'auto-détection. Voir [Réglages](settings.md) pour la résolution de l'organisation.

## Et ensuite ?

- **Modifier** les tokens comme dans n'importe quel projet : renommer, réimbriquer,
  ajouter des modes, relier des alias.
- **Committer** le dossier. C'est du JSON simple à ordre de clés stable : les diffs
  restent relisables.
- **Convertir** vers les formats attendus par vos applications avec le configurateur de
  [Distribution](distribution.md) : variables CSS, SCSS, TypeScript, JSON.
- **Le pousser vers Figma** avec le plugin compagnon, qui lit le même `manifest.json`.
