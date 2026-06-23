---
icon: lucide/rocket
---

# Démarrer

Token Flow Manager s'exécute sur votre ordinateur et ouvre un tableau de bord dans
votre navigateur. Vous avez seulement besoin de **Node.js 20 ou plus récent**
([à télécharger ici](https://nodejs.org)).

## 1. Télécharger

Rendez-vous sur la [page des Releases](https://github.com/robinlopez/token-flow-manager/releases)
et téléchargez le fichier nommé `token-flow-manager-0.1.0.tgz`.

## 2. Installer

Ouvrez un terminal dans le dossier où vous avez téléchargé le fichier, puis lancez :

```bash
npm install -g ./token-flow-manager-0.1.0.tgz
```

Cela installe la commande `tokenflow` sur votre ordinateur. À faire une seule fois.

## 3. Lancer

Ensuite, il suffit de taper :

```bash
tokenflow
```

Un écran d'accueil s'ouvre dans votre navigateur. Choisissez un projet récent ou
parcourez un dossier.

!!! tip "Ouvrir un projet directement"

    Vous pouvez aussi pointer directement sur un dossier de projet :

    ```bash
    tokenflow ./mes-design-tokens
    ```

## Autres commandes

```bash
tokenflow validate    # vérifie vos tokens, échoue si quelque chose ne va pas
tokenflow init        # crée un tokenflow.config.json dans le dossier courant
```

## Configuration

Token Flow Manager lit deux fichiers :

- **`manifest.json`** : l'organisation de vos tokens (collections et modes).
- **`tokenflow.config.json`** : les préférences de l'outil uniquement. Créez-en un avec
  `tokenflow init`.

## Étapes suivantes

- Découvrez tout ce que fait le tableau de bord sur la page [Fonctionnalités](features.md).
- Envie de compiler ou de contribuer ? Lisez la page [Développement](development.md).
