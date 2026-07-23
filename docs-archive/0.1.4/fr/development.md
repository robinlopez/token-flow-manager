---
icon: lucide/wrench
---

# Développement

## Structure du monorepo

| Paquet | Rôle |
|---|---|
| `@tokenflow/shared` | Schémas Zod et types : nœuds DTCG, modèle interne, diagnostics, config, charges utiles d'API. |
| `@tokenflow/core` | Moteur : parseur DTCG (positions source), résolveur d'alias, validateur de valeurs, mutation de document préservant le formatage. |
| `@tokenflow/server` | Fastify REST + WebSocket, `Session`, `ProjectManager`, surveillance chokidar, écritures atomiques avec sauvegardes tournantes. |
| `token-flow-manager` (CLI) | Point d'entrée `npx` (commander). Bundle autonome qui inline les paquets du workspace et embarque le tableau de bord compilé. |
| `@tokenflow/web` | Tableau de bord Angular : écran d'accueil, shell, barre latérale, tableau des variables, inspecteur, temps réel. |

## Mise en place

```bash
pnpm install
pnpm -r --filter "./packages/*" test      # tests unitaires + intégration
pnpm -r --filter "./packages/*" typecheck # TS strict partout
```

## Ordre de compilation

Compilez **dans l'ordre des dépendances**. Le build du CLI embarque le tableau de bord
fraîchement compilé, donc `@tokenflow/web` doit être compilé **avant**
`token-flow-manager` :

```bash
pnpm --filter @tokenflow/shared build
pnpm --filter @tokenflow/server build
pnpm --filter @tokenflow/web build
pnpm --filter token-flow-manager build    # bundle le CLI + embarque la SPA dans dist/web
```

Lancez sur un projet de démo, ou sans chemin pour l'écran d'accueil :

```bash
node packages/cli/dist/cli.js ./examples/basic   # ouvrir un projet
node packages/cli/dist/cli.js                     # écran d'accueil
```

## Application de bureau (.dmg / .app / .exe)

Une application de bureau native est construite avec **Tauri** : la fenêtre charge le
tableau de bord Angular embarqué, et un **sidecar** (le serveur compilé en un binaire
unique avec `bun build --compile`) exécute l'API.

```bash
# Nécessite la toolchain Rust (https://rustup.rs) + Bun, une seule fois.
pnpm install
pnpm desktop:build      # → src-tauri/target/release/bundle/{dmg,macos}/…
```

Compilez sur chaque OS cible pour son installeur (`.dmg` sur macOS, `.msi`/`.exe` via
NSIS sur Windows, `.AppImage`/`.deb` sur Linux).

## Travailler sur cette documentation

La documentation est construite avec [Zensical](https://zensical.org). Depuis la racine
du dépôt :

```bash
pnpm docs:dev          # aperçu anglais avec live reload sur http://localhost:8000
pnpm docs:dev:fr       # aperçu français
pnpm docs:build        # construit le site statique (EN + FR) dans ./site
```

L'anglais est servi à la racine, le français sous `/fr/`. Les deux langues ont leur
propre fichier de config (`zensical.toml` et `zensical.fr.toml`) : gardez-les
synchronisés en cas de changement de réglage. Un push sur `master` reconstruit et
déploie automatiquement sur GitHub Pages.
