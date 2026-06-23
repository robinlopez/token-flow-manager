---
icon: lucide/sparkles
---

# Fonctionnalités

## Gestion des projets

- **Écran d'accueil** : projets récents (supprimables avec ×) et un sélecteur de
  dossier natif ("Parcourir votre ordinateur…") avec une saisie de chemin en secours.
  Ouvrez un projet depuis l'interface, sans chemin en ligne de commande.
- **Sélecteur de projet** : l'en-tête affiche le nom du projet ouvert avec un chevron ;
  le menu déroulant bascule vers un projet récent sur place ou revient à l'écran
  d'accueil.

## Édition des tokens

- **Tableau des variables** : colonnes de modes (clair/sombre/marque et plus), puces
  d'alias, édition en ligne, colonnes redimensionnables.
- **Arbre de groupes** : glisser-déposer à la Finder. Déposez un groupe sur un autre
  pour l'**imbriquer**, ou entre deux groupes pour **réordonner**. Sélection multiple
  avec ⌘/Ctrl-clic et Maj-clic pour en déplacer plusieurs à la fois.
- **Copier / Couper / Coller des variables** (++cmd+c++ / ++cmd+x++ / ++cmd+v++) :
  couper masque les lignes immédiatement et les déplace au collage ; copier duplique.
- **Annuler / Rétablir** (++cmd+z++ / ++cmd+shift+z++) : exact à l'octet, côté serveur.

## Rechercher et corriger

- **Recherche** (++cmd+s++) et filtres : alias, dépréciés, orphelins, erreurs, ainsi
  qu'une **palette de commandes**.
- **Diagnostics** avec corrections en un clic.
- **Inspecteur** avec chaînes d'alias et références entrantes.
- **Aide des raccourcis clavier** (++cmd+slash++ ou ++question++) et la version de
  l'application dans le pied de page.

## Modèle de sûreté

!!! info "Il ne commit jamais"

    Token Flow Manager modifie le JSON source **sur place**, de façon atomique, en
    préservant l'ordre des clés et le formatage. Le serveur reste local à votre machine,
    surveille les fichiers, et conserve des sauvegardes tournantes à l'écriture.

- [x] Écritures atomiques préservant le formatage
- [x] Résolution des alias entre collections et modes (cycles, références cassées détectés)
- [x] Conforme DTCG 2025.10
- [x] 100 % local, rien ne quitte votre machine
