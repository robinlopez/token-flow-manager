---
icon: lucide/home
---

# Token Flow Manager

Gestionnaire local de **Design Tokens**. Visualisez, modifiez et gouvernez vos
fichiers de tokens **DTCG 2025.10** depuis un tableau de bord visuel, sans quitter
votre projet.

L'outil démarre un serveur local sur votre machine, lit chaque fichier
`*.tokens.json`, résout les alias à travers les collections et les modes, puis ouvre
un tableau de bord dans votre navigateur. Il ne **commit jamais** : il modifie le JSON
source sur place, de façon atomique, en préservant l'ordre des clés et le formatage.
Lancez-le sans chemin et un écran d'accueil vous laisse ouvrir un projet récent ou en
parcourir un.

[Démarrer :material-arrow-right:](getting-started.md){ .md-button .md-button--primary }
[Voir sur GitHub :fontawesome-brands-github:](https://github.com/robinlopez/token-flow-manager){ .md-button }

## En bref

- **Écran d'accueil** avec projets récents et sélecteur de dossier natif.
- **Tableau des variables** : colonnes de modes (clair/sombre/marque et plus), puces
  d'alias, édition en ligne.
- **Barre latérale type Finder** : glisser-déposer pour imbriquer ou réordonner les
  groupes de tokens.
- **Copier / Couper / Coller** des variables entières, **Annuler / Rétablir**,
  recherche, palette de commandes.
- **Diagnostics** avec corrections en un clic et un inspecteur de chaînes d'alias.

Une visite complète se trouve sur la page [Fonctionnalités](features.md).

!!! note "Préservation du formatage par conception"

    Token Flow Manager modifie votre JSON source **sur place**, de façon atomique, en
    conservant l'ordre des clés et le formatage intacts. Les diffs restent minimaux et
    relisables.
