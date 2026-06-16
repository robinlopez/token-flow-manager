# Token Flow Manager — Plan technique & fonctionnel

> **Statut** : en cours — Phases 1, 2 ✅ ; Phase 3 partielle ; **Phase 3.5 quasi complète** (drag/édition Figma-like, multi-sélection, rename inline, menu contextuel, autocomplete alias typé, gestionnaire de config dans Settings) ; **Phase 3.5.5 ✅** (color picker en cellule, steppers dimension/number + ↑/↓, éditeur composite expand-in-place) ; **Phase 3.6 ✅** (Undo/Redo byte-exact serveur, raccourcis ⌘Z/⌘⇧Z, boutons header, toast) ; **création de variables ✅** (bouton toolbar + dropdown de type, `+` par groupe, `createToken` mode-aware) ; **picker couleur/alias façon Figma** (Custom + Libraries type-aware, ancré) ; **Phase 3.7 (robustesse du typage) planifiée** ; **Phase 5 — Intégration Git (lecture seule, non-intrusive) planifiée** (spec §4.6/§6.2, pas encore codée) ; **v0.1.0 prête pour `npm publish`** (package CLI autonome vérifié, voir §10) ; **Phase 4 — Distribution** : socle livré (éditeur de manifest + scaffolding script SD v3) → **REDESIGN en cours** : cible **Style Dictionary v5**, UX guidée (assistant Sources → Theming → Cibles), multi-cibles/emplacements, **test build avec rapport**. **Détail : [CHANGELOG.md](CHANGELOG.md) + section Phase 4 ci-dessous.**
> **Cible** : développeur senior, intégration de bout en bout
> **Standard de référence** : [DTCG Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
> **Écosystème** : complément des outils Token Forge (Figma) et Token Flow (IDE)
> **👉 Reprise du dev** : lire **[HANDOFF.md](HANDOFF.md)** (état précis, archi, conventions, pièges, prochaines tâches).

---

## 1. Vision et Objectifs

### 1.1 Vision

Token Flow Manager est un **gestionnaire local de Design Tokens** distribué comme package NPM, exécutable via `npx token-flow-manager` au sein d'un projet. Il démarre un serveur Node.js local et expose un dashboard web qui permet de **visualiser, éditer et gérer de manière bidirectionnelle** les fichiers JSON de tokens d'un projet, sans jamais quitter l'environnement de travail du développeur.

Il se positionne comme la pièce manquante d'un écosystème en trois temps :

- **Token Forge** (Figma) → autorité de conception, source de vérité visuelle.
- **Token Flow** (IDE) → audit et substitution dans le code applicatif.
- **Token Flow Manager** (local) → édition, gouvernance et synchronisation des fichiers JSON sources.

### 1.2 Objectifs produit

1. **Édition fluide et sûre** des fichiers `.tokens.json` (ou équivalents) sans corruption ni perte de structure.
2. **Conformité stricte** au format DTCG 2025.10, y compris les ajouts récents (`$extends`, Oklch/Display P3, JSON Pointer aliases).
3. **Gestion native du multi-collection et multi-mode** (Light/Dark, marques, contrastes élevés) sans duplication.
4. **Résolution d'alias en temps réel** avec détection des cycles et des références brisées.
5. **Intégration Git non-intrusive** : le tool ne commit pas, mais il *informe* sur l'état du working tree.
6. **Zero-config par défaut**, configuration explicite via `tokenflow.config.{ts,js,json}` si besoin.
7. **Performance** : doit rester réactif sur des bases dépassant 5 000 tokens et 50 fichiers.

### 1.3 Non-objectifs (v1)

- Pas de mode multi-utilisateurs / collaboratif temps réel (l'outil reste local et mono-session).
- Pas de génération de code plateforme (Style Dictionary, Theo… restent en aval).
- Pas de moteur de build/transformation : Token Flow Manager **gère** les sources, il ne les **compile** pas.
- Pas d'authentification ni de gestion de droits (le serveur écoute exclusivement sur `127.0.0.1`).

---

## 2. Architecture Technique

### 2.1 Vue d'ensemble

```
┌────────────────────────────────────────────────────────────────────┐
│  npx token-flow-manager                                            │
│                                                                    │
│  ┌──────────────┐   stdio/exec    ┌───────────────────────────┐   │
│  │   CLI Entry  │ ───────────────▶│   Node.js Local Server     │   │
│  │  (commander) │                  │   (Fastify, port auto)    │   │
│  └──────────────┘                  └─────────┬──────────────────┘  │
│                                              │                      │
│                                ┌─────────────┼─────────────┐        │
│                                ▼             ▼             ▼        │
│                          ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│                          │   FS     │  │  Token   │  │   Git    │  │
│                          │  Layer   │  │  Engine  │  │  Adapter │  │
│                          │(chokidar)│  │ (parser, │  │(simple-  │  │
│                          │          │  │ resolver)│  │  git)    │  │
│                          └──────────┘  └──────────┘  └──────────┘  │
│                                              ▲                      │
│                                              │  WebSocket + REST    │
│                                              ▼                      │
│                                  ┌────────────────────────┐         │
│                                  │   Web Dashboard         │         │
│                                  │   (Angular 18+, esbuild)│         │
│                                  │   ouvert dans browser   │         │
│                                  └────────────────────────┘         │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Stack recommandée

#### Backend (Node.js ≥ 20)

| Domaine | Choix recommandé | Justification |
|---|---|---|
| Runtime | Node.js ≥ 20 LTS | Support natif `fetch`, `node:test`, performances V8 récentes. |
| Langage | TypeScript (strict) | Typage du modèle de tokens essentiel pour la fiabilité. |
| HTTP server | **Fastify** | Schémas JSON natifs (validation), plugin system, perf supérieure à Express, parfait pour un serveur local. |
| WebSocket | `@fastify/websocket` | Synchronisation push (file watcher → UI). |
| CLI | **commander** + `prompts` | Standard de facto, bonne ergonomie. |
| File watching | **chokidar** | Robuste sur tous OS, debouncing intégré. |
| JSON parsing | **`json-source-map`** + parser custom | Préservation des positions de chaque token (utile pour erreurs ligne/colonne et écriture chirurgicale). |
| Validation schéma | **Zod** | Schémas typés, dérivation TS, parsing safe. |
| Écriture atomique | **`write-file-atomic`** | Garantie no-corruption (rename atomique). |
| Git | **simple-git** | API simple, lecture seule pour l'essentiel (status, diff). |
| Logging | **pino** | Faible overhead, transport pretty en dev. |

#### Frontend (Web Dashboard) — **Stack Angular**

| Domaine | Choix recommandé | Justification |
|---|---|---|
| Framework | **Angular 18+** (standalone, signals, control flow) | Modèle de réactivité moderne (signals + computed), DI puissante, parfait pour un outil orienté données structurées. Cohérent avec ta stack. |
| Build | **Angular CLI + esbuild** (par défaut depuis v17) | Démarrage < 1 s, HMR fiable, zero-config raisonnable. |
| Langage | TypeScript strict (`strict: true`, `strictTemplates: true`) | Le modèle de tokens est trop complexe pour transiger. |
| State local | **Signals natifs** + `computed` | Le resolver d'alias se mappe naturellement à un graphe de signaux. |
| State global | **`@ngrx/signals`** (Signal Store) | Léger, sans boilerplate Redux. Gère parfaitement la pile undo/redo et les collections. |
| HTTP | **`HttpClient`** + interceptors | Standard Angular, observables convertis en signals via `toSignal()`. |
| Cache serveur | **`@tanstack/angular-query`** | Synchronisation REST avec invalidation fine, intégration signals native. |
| Routing | **Angular Router** (standalone routes) | Navigation par collection / groupe / token via URL partageable. |
| UI primitives | **Angular CDK** (Overlay, Portal, A11y, VirtualScroll, DragDrop) | Couche bas-niveau officielle, sans dette visuelle. |
| Composants | **Spartan-ng** (port shadcn pour Angular) ou composants custom | Cohérence visuelle et ownership du code. **Pas Angular Material** : trop opinionated visuellement. |
| Styling | **Tailwind CSS** + variables CSS custom | Densité d'information + theming runtime (les variables du dashboard sont elles-mêmes des tokens). |
| Virtualisation | **CDK VirtualScroll** + `cdk-virtual-scroll-viewport` | Indispensable pour le tableau de tokens. |
| Forms | **Reactive Forms** + `FormControl` typés | Inspector d'édition complexe (composites). |
| Color picker | Custom Angular + **`culori`** | Pas de lib mature OKLCH+P3 en Angular : on construit un picker minimaliste sur `culori` (conversion d'espaces). |
| Édition JSON | **Monaco Editor** (`ngx-monaco-editor-v2`) | Vue "raw JSON" avec validation live + autocomplétion sur les paths d'alias. |
| Diff visuel | **Monaco diff editor** (intégré) | Affichage des modifs non-commitées. |
| Icons | **Lucide Angular** | Cohérent avec un look "tool". |

### 2.3 Communication Front ↔ Back

Deux canaux complémentaires :

- **REST/JSON** (Fastify) pour les opérations explicites : `GET /api/collections`, `PUT /api/tokens/:path`, `POST /api/tokens/validate`, etc. Consommé côté Angular via `HttpClient` + `@tanstack/angular-query`.
- **WebSocket** pour le push : modifications de fichiers détectées par chokidar, mise à jour de l'état Git, broadcast d'événements de session. Côté Angular : un service `RealtimeService` expose un signal `events$` que les composants consomment via `toSignal()`.

**Convention** : tous les payloads sont validés Zod côté serveur. Les types Zod sont partagés via un package interne `packages/shared`. Côté Angular, on dérive les interfaces TypeScript de ces schémas (un script `gen:types` exécute `zod-to-ts` au build).

### 2.4 Structure de monorepo

```
token-flow-manager/
├── packages/
│   ├── cli/              # Point d'entrée npx, parsing args, lifecycle
│   ├── server/           # Fastify + endpoints + WS
│   ├── core/             # Token engine (parser, resolver, validator)
│   ├── shared/           # Schémas Zod + types générés
│   └── web/              # Dashboard Angular
│       ├── src/app/
│       │   ├── core/           # services (api, realtime, git, state)
│       │   ├── features/
│       │   │   ├── shell/      # layout principal, sidebar, header
│       │   │   ├── variables-table/  # tableau central
│       │   │   ├── inspector/  # panneau d'édition
│       │   │   ├── diagnostics/
│       │   │   └── settings/
│       │   ├── stores/         # NgRx Signal Stores
│       │   └── ui/             # composants Spartan + custom
│       └── angular.json
├── pnpm-workspace.yaml
└── package.json
```

Gestionnaire de paquets : **pnpm** (workspaces, dédoublonnage, vitesse).
Build : **tsup** pour les packages Node, **Angular CLI/esbuild** pour `web`. Bundle final servi statiquement par Fastify.

---

## 3. Modèle de Données et Format W3C

### 3.1 Conformité DTCG 2025.10

La spec stable d'octobre 2025 fixe les éléments suivants que nous prenons comme **socle non négociable** :

- Propriétés préfixées par `$` (`$value`, `$type`, `$description`, `$extensions`, `$deprecated`, `$extends`).
- Groupes : tout objet JSON sans `$value` est un groupe ; il peut porter `$type` (héritage par défaut), `$description`, `$extensions`.
- Aliases : `"{group.subgroup.token}"` (curly braces) **et** JSON Pointer (`"#/group/subgroup/token"`).
- Types couverts : `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`, `strokeStyle`, `border`, `transition`, `shadow`, `gradient`, `typography`.
- Color spaces : sRGB, Display P3, Oklch, et l'ensemble CSS Color Module 4.
- `$extends` pour l'héritage multi-mode / multi-brand.

### 3.2 Représentation interne

Le format DTCG est conçu pour le **fichier**, pas pour la **manipulation**. On dérive donc une représentation interne plus pratique, gardée en mémoire côté serveur et exposée à Angular via REST.

```ts
// packages/shared/src/types.ts

type TokenPath = string[]; // ex: ['color', 'brand', 'primary']

interface ParsedToken {
  id: string;                    // hash stable de path + collection
  path: TokenPath;
  collection: string;            // ex: 'core', 'semantic', 'component'
  group: string;                 // groupe top-level (surface, spacing, …)
  type: DtcgType;
  rawValuesByMode: Record<string, unknown>;  // ex: { light: '#fff', dark: '#000' }
  resolvedValuesByMode: Record<string, unknown>;
  isAlias: boolean;
  aliasChainsByMode?: Record<string, TokenPath[]>;
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
  source: {
    file: string;
    line: number;
    column: number;
  };
  diagnostics: Diagnostic[];
}

interface Collection {
  id: string;
  name: string;                  // 'Tokens', 'Components', etc.
  files: string[];
  modes: ModeDefinition[];       // ex: [{ id: 'light' }, { id: 'dark' }]
  groups: GroupNode;
  tokens: ParsedToken[];
}
```

> **Point clé** : la structure `rawValuesByMode` / `resolvedValuesByMode` est conçue pour le rendu **Figma-like** (un token = une ligne, un mode = une colonne). C'est la représentation pivot du dashboard.

L'écriture vers le disque passe par un **sérialiseur** qui reconstruit le JSON DTCG à partir du modèle interne — en préservant l'ordre des clés et la mise en forme grâce à `json-source-map`.

### 3.3 Architecture multi-collection

Un projet Token Flow Manager se décrit via `tokenflow.config.ts` :

```ts
export default {
  collections: [
    { name: 'Tokens',     files: 'tokens/core/**/*.tokens.json',     modes: ['light', 'dark'] },
    { name: 'Semantic',   files: 'tokens/semantic/**/*.tokens.json', modes: ['light', 'dark', 'highContrast'] },
    { name: 'Components', files: 'tokens/components/**/*.tokens.json' },
  ],
  resolution: {
    crossCollection: true,
    order: ['Tokens', 'Semantic', 'Components'],
  },
};
```

Les collections sont **résolues dans l'ordre** : un token `Semantic` peut référencer `Tokens`, mais pas l'inverse. Ce garde-fou est appliqué à la validation.

### 3.4 Gestion des modes (sans duplication)

Trois stratégies sont supportées, l'utilisateur choisit selon ses fichiers :

#### Stratégie A — `$extends` (DTCG natif, recommandé)

Un fichier `dark.tokens.json` étend `light.tokens.json` et ne déclare que les overrides.

#### Stratégie B — fichiers parallèles par mode (`*.{mode}.tokens.json`)

Le manager associe par convention de nommage, configurable.

#### Stratégie C — modes inline (style Tokens Studio)

```json
{
  "color": {
    "bg": {
      "$type": "color",
      "$value": { "light": "#fff", "dark": "#000" }
    }
  }
}
```

Pris en charge en lecture, **converti en stratégie A à l'écriture** si l'utilisateur l'autorise (option `normalizeOnSave`).

### 3.5 Valeurs composites

Les types composites (`typography`, `shadow`, `border`, `gradient`, `transition`) sont représentés comme des objets typés. L'éditeur doit proposer un **éditeur dédié par type composite** — pas un simple input textuel.

Exemple `typography` :

```json
{
  "heading-lg": {
    "$type": "typography",
    "$value": {
      "fontFamily": "{font.family.sans}",
      "fontWeight": "{font.weight.bold}",
      "fontSize": "2rem",
      "lineHeight": 1.2,
      "letterSpacing": "-0.01em"
    }
  }
}
```

Chaque sous-propriété peut être un alias indépendant — le resolver descend récursivement.

---

## 4. Spécifications Fonctionnelles

### 4.1 Cycle de vie d'une session

1. `npx token-flow-manager [path]` → détection ou création de `tokenflow.config`.
2. Scan initial : parsing de tous les fichiers, construction du modèle, validation, indexation.
3. Démarrage du serveur (port auto, fallback `5173+`).
4. Ouverture du navigateur sur `http://127.0.0.1:<port>`.
5. Watcher actif : toute modif externe (IDE, Git pull) est répercutée en UI via WebSocket.
6. Arrêt propre via `Ctrl+C` → flush des écritures en attente, fermeture WS.

### 4.2 Opérations CRUD sur tokens

| Opération | Endpoint | Effets |
|---|---|---|
| Lire un token | `GET /api/tokens/:collection/:path` | Retourne `ParsedToken` complet (raw + resolved par mode). |
| Créer | `POST /api/tokens` | Validation type/value, écriture atomique, broadcast WS. |
| Modifier valeur (un mode) | `PATCH /api/tokens/:id/values/:mode` | Re-resolve global si alias impactés. |
| Renommer | `POST /api/tokens/:id/rename` | Met à jour toutes les références entrantes (rename safe). |
| Déplacer | `POST /api/tokens/:id/move` | Change la `path` ou la collection. |
| Supprimer | `DELETE /api/tokens/:id` | Alerte si références entrantes, propose un fix. |
| Ajouter un mode | `POST /api/collections/:id/modes` | Initialise les valeurs sur le mode source choisi. |
| Renommer un mode | `PATCH /api/collections/:id/modes/:mode` | Propage le rename dans tous les fichiers du scope. |

Toutes les opérations passent par une **couche transactionnelle** : modifications appliquées en mémoire, validées, puis flushées sur disque en lot.

### 4.3 Résolution des alias

- **Lecture** : parsing récursif des `{token.path}` et JSON Pointers, traversée multi-fichiers et multi-collections, par mode.
- **Détection de cycles** : coloriage (white/gray/black) ; tout cycle attache un `Diagnostic` sévérité `error` sur les tokens impliqués.
- **Alias brisés** : référence vers un path inexistant → diagnostic, suggestion via fuzzy match (Levenshtein).
- **Affichage de la valeur résolue** : l'API renvoie systématiquement `rawValuesByMode` ET `resolvedValuesByMode`, plus la chaîne d'alias par mode.

### 4.4 Recherche et filtrage

Index full-text construit avec **MiniSearch** (côté serveur) sur :

- path du token, description, valeur résolue, type, collection, mode.

Filtres combinables : type, collection, mode, "dépréciés", "alias seulement", "orphelins" (aucune référence entrante).

### 4.5 Historique et Undo/Redo

- **Pile d'opérations** limitée (par défaut 100), implémentée côté serveur (toute action UI passe par un `Command` réversible).
- Côté Angular : Signal Store `historyStore` (`canUndo`, `canRedo`, `stack`).
- Non persistée sur disque — la véritable mémoire est Git.
- Granularité : une action atomique = un item d'historique (le rename d'un alias en cascade reste un seul item).

### 4.6 Intégration Git

Lecture seule par défaut. Le manager ne fait JAMAIS de commit, merge, push ou pull.

- Détection du dépôt Git (parent du cwd).
- État du working tree par fichier de tokens (clean / modified / untracked).
- Diff visuel des modifications en cours par rapport à `HEAD` (Monaco diff editor).
- Indicateur global "X fichiers modifiés, Y tokens impactés".
- **Discard local changes** sur un fichier (confirmation forte).
- Détection de **conflits de merge** : si markers `<<<<<<<`, le fichier passe en lecture seule, badge "Conflit", invite à résoudre dans l'IDE.

### 4.7 Écriture sécurisée

- `write-file-atomic` (écriture dans un fichier temporaire + `rename`).
- Validation Zod préalable du document complet.
- **Debounce** configurable (défaut 200 ms) pour grouper les éditions rapides.
- **Backup transparent** : avant chaque écriture, copie dans `.tokenflow/backups/` (rotation 50 fichiers).

---

## 5. UI/UX du Dashboard

### 5.1 Principes directeurs

L'interface s'inspire directement du **panneau Variables de Figma** : un tableau central dense où chaque ligne est une variable et **chaque mode est une colonne**. Cette approche permet de comparer visuellement les valeurs d'un token à travers ses modes, sans switcher contextuel.

Principes :

- **Pas de switcher de mode global** — les modes sont des colonnes visibles simultanément.
- **Tableau hautement scannable** : icône de type, nom du token, chips colorés pour les alias, valeurs résolues en surbrillance secondaire au survol.
- **Inspector contextuel** : ne s'ouvre qu'à l'édition fine, panel latéral droit ou popover ancré.
- **Densité par défaut** : pas de marges molles, lignes compactes, navigation clavier complète.

### 5.2 Layout général

```
┌───────────────────────────────────────────────────────────────────────────┐
│ HEADER  ▸ tokenflow · /Users/eddy/projects/ds-acme · main ●  ⌘K   ⚙       │
├──────────────────────┬────────────────────────────────────────────────────┤
│ SIDEBAR              │           MAIN — Variables Table                   │
│                      │                                                    │
│ Collection ▼         │  ┌──────────────────────────────────────────────┐  │
│ ┌──────────────────┐ │  │  Name              | Light    | Dark      + │  │
│ │ Tokens        ▼  │ │  ├──────────────────────────────────────────────┤  │
│ └──────────────────┘ │  │ ▾ surface                                    │  │
│                      │  │ ◐ surface-primary  | gray/50  | gray/900     │  │
│ All variables    19  │  │ ◐ surface-secondary| gray/800 | gray/400     │  │
│                      │  │ ◐ surface-invert   | gray/900 | gray/50      │  │
│ ▸ surface         5  │  │ ◐ surface-brand    | watermelon | watermelon │  │
│ ▸ spacing         6  │  │                                              │  │
│ ▸ radius          4  │  │ ▾ spacing                                    │  │
│ ▸ text            2  │  │ # spacing-none     | 0        | 0            │  │
│ ▸ border          2  │  │ # spacing-xs       | spacing/.5| spacing/.5  │  │
│                      │  │ # spacing-sm       | spacing/1| spacing/1    │  │
│ ──────────────────   │  │                                              │  │
│ Diagnostics          │  │  + Create variable                           │  │
│ ● 2 errors           │  │                                              │  │
│ ▲ 5 warnings         │  └──────────────────────────────────────────────┘  │
├──────────────────────┴────────────────────────────────────────────────────┤
│ FOOTER ▸ 2 errors · 5 warnings · 3 files modified (Git) · 19 tokens       │
└───────────────────────────────────────────────────────────────────────────┘
```

Lorsqu'un token est édité : un **panel inspector** glisse de la droite (CDK Overlay) et masque la dernière colonne tout en restant non-bloquant.

### 5.3 Sidebar — Navigation

- **Sélecteur de collection** en tête (dropdown). Bascule entre `Tokens`, `Components`, etc.
- **"All variables"** + compteur — vue à plat.
- **Liste des groupes** (top-level keys du DTCG : `surface`, `spacing`, `radius`, `text`, `border`…) avec compteurs.
- **Section Diagnostics** en bas : erreurs / warnings cliquables, ouvrent un drawer dédié.
- Navigation 100% au clavier (`j/k`, `Enter` pour ouvrir l'inspector, `Esc` pour fermer).

### 5.4 Main — Tableau Variables (cœur du dashboard)

Structure colonne :

| Colonne | Contenu | Largeur |
|---|---|---|
| Nom | Icône type + nom du token | flexible (min 240px) |
| Mode 1 (ex: Light) | Chip d'alias OU valeur littérale | équilibré |
| Mode 2 (ex: Dark) | Idem | équilibré |
| Mode N… | | |
| `+` | Ajouter un mode | 32px |

Pour chaque cellule :

- **Valeur littérale** : preview directe (carré coloré + hex pour `color`, valeur numérique avec unité pour `dimension`).
- **Alias** : chip rectangulaire arrondi sur fond gris léger avec icône de type à gauche, texte du path à droite (ex: `◐ color/gray/50`). Survol → tooltip avec la valeur résolue. Clic → navigation vers le token cible.
- **Cellule vide pour un mode** : placeholder discret `—` + tooltip "non défini pour ce mode" + quick-fix "hériter de Light".

Au survol d'une ligne :

- Apparition d'actions inline : `⋯` (menu : Rename, Duplicate, Delete, Deprecate, Open inspector).
- Highlight subtil de la ligne.

**Virtualisation** via `cdk-virtual-scroll-viewport` dès que les tokens dépassent 200 lignes.
**Group headers** : sticky en haut du viewport lors du scroll (Notion-like).

### 5.5 Inspector — Édition fine (panel droit)

S'ouvre via clic sur la ligne ou raccourci `Enter`. Glisse depuis la droite (CDK Overlay), largeur ~380px, dismiss au clic extérieur ou `Esc`.

Sections :

- **En-tête** : icône type + nom + breadcrumb (`surface › surface-primary`).
- **Métadonnées** : type, description (éditable).
- **Values** : un bloc par mode, avec toggle "literal ↔ alias", color picker dédié, éditeur composite si applicable, et chaîne d'alias cliquable.
- **References** : "Used in X tokens" et "Used in Y components", listes développables.
- **Source** : fichier + ligne, lien "Open in editor" qui lance l'IDE détecté.

### 5.6 Recherche globale (Command Palette)

Raccourci `⌘K` / `Ctrl+K`. Ouvre une palette de recherche fuzzy sur :

- Tokens (nom, valeur résolue, description).
- Actions : "Create variable", "Add mode", "Toggle diagnostics", "Open file…".

### 5.7 Diagnostics

Drawer dédié accessible depuis la sidebar ou le footer :

- Liste groupée par sévérité puis par fichier.
- Chaque entrée : token impacté, message, quick-fix (si disponible).
- Filtres : sévérité, collection, mode, type d'erreur.

### 5.8 Vues alternatives

Toggle en haut à droite du tableau pour basculer entre :

- **Table** (vue par défaut, décrite ci-dessus).
- **Grid** : cartes visuelles, utile pour la revue d'une palette ou d'un set de typographie.
- **JSON** : Monaco Editor en lecture/écriture sur le fichier courant, validation live, autocomplete sur les paths d'alias.

---

## 6. Gestion des Edge Cases

### 6.1 Alias

| Cas | Comportement |
|---|---|
| Alias vers token inexistant | Diagnostic `error`, suggestion fuzzy, écriture bloquée tant que non résolu. |
| Cycle (A→B→A) | Détection à la résolution, marquage des deux tokens, écriture bloquée. |
| Cycle indirect (A→B→C→A) | Idem, le rapport indique la chaîne complète. |
| Type incompatible (`color` aliasé vers `dimension`) | Diagnostic `error`. |
| Profondeur d'alias excessive (>10) | Diagnostic `warning`, configurable. |
| Alias dans une sous-propriété composite | Résolu indépendamment ; possibilité de "résoudre partiellement". |
| Alias résolu différemment selon le mode | Chaque mode affiche sa propre chaîne dans l'inspector. |

### 6.2 Conflits de fusion Git

- Détection passive : si le watcher voit apparaître des markers `<<<<<<<`, le fichier passe en **lecture seule**, badge "Conflit" affiché.
- Aucune tentative de résolution automatique : l'utilisateur résout dans son IDE/git tool, le manager recharge automatiquement à la sauvegarde.

### 6.3 Erreurs de parsing JSON

- Erreur de syntaxe → diagnostic avec ligne/colonne précise (via `json-source-map`).
- Le reste du projet reste utilisable ; seul le fichier fautif est isolé.
- Bouton "Ouvrir dans l'éditeur" lance l'IDE par défaut (`code`, `subl`, etc.) via une commande shell détectée.

### 6.4 Modifications concurrentes (FS externe vs UI)

- Le serveur compare le hash du fichier au moment de la lecture et au moment de l'écriture.
- Si différents pendant une édition UI non flushée → l'écriture est refusée, modal "Le fichier a changé sur le disque" propose : (1) recharger, (2) écraser, (3) ouvrir un diff visuel.

### 6.5 Renommage et propagation

- Un rename de token déclenche un scan de toutes les références (raw `{path}` ET JSON Pointer).
- L'UI affiche le diff complet AVANT confirmation : "12 fichiers seront modifiés, 47 références mises à jour".
- L'opération est atomique : tous les fichiers sont écrits, ou aucun (rollback en cas d'erreur).

### 6.6 Tokens orphelins et doublons

- **Orphelins** : tokens jamais référencés ailleurs et jamais exportés. Affichés via filtre dédié, jamais supprimés sans action explicite.
- **Doublons** : tokens ayant la même valeur résolue. Détection en background, suggestion de factorisation via alias.

### 6.7 Mode ajouté ou supprimé

- Ajout : initialisation par copie d'un mode source choisi par l'utilisateur (modal "Quel mode utiliser comme base ?").
- Suppression : confirmation forte, vérification qu'aucune référence externe ne dépend exclusivement de ce mode.

### 6.8 Performance sur grosses bases

- Indexation incrémentale : seuls les fichiers modifiés sont re-parsés.
- Resolver incrémental : seul le sous-graphe impacté est recalculé sur édition.
- Virtualisation systématique côté UI (CDK VirtualScroll).
- Pagination des diagnostics au-delà de 500 entrées.

### 6.9 Compatibilité formats legacy

- Style Dictionary v3 (sans préfixes `$`) : lecture supportée, conversion vers DTCG proposée à l'utilisateur (jamais automatique).
- Tokens Studio (modes inline) : lecture supportée, normalisation optionnelle.

---

## 7. Roadmap de développement

### Phase 1 — Fondations (≈ 4 semaines)

**Objectif** : un MVP qui lit, affiche et édite un seul fichier DTCG en respectant l'intégrité du JSON, avec UI Angular fonctionnelle.

- [x] Setup monorepo (pnpm + tsup + Angular **21** + TS strict).
- [x] CLI minimale (`npx token-flow-manager`) — + `validate` et `init`.
- [x] Serveur Fastify + endpoints REST de base.
- [x] Parser DTCG 2025.10 (types scalaires) — + **typage tolérant** (inférence, types non-DTCG).
- [x] Validation Zod + types TS partagés (`@tokenflow/shared`).
- [x] Écriture atomique avec `write-file-atomic` (+ backups rotatifs).
- [x] **Dashboard Angular** : shell + sidebar + tableau Variables + inspector.
- [x] Signal Store `ProjectStore` avec actions CRUD (signals natifs, pas ngrx pour l'instant).
- [x] Édition valeur littérale (inputs typés ; color picker OKLCH → Phase 3).
- [x] WebSocket + chokidar pour le reload externe.

**Critère de sortie** : ouvrir un projet, éditer une couleur, fermer, rouvrir, voir la modification persistée sans corruption.

### Phase 2 — Aliases et résolution (≈ 3 semaines)

**Objectif** : résoudre toute la complexité référentielle.

- [x] Resolver multi-collection avec ordre configurable.
- [x] Support des deux syntaxes (`{token.path}` + JSON Pointer).
- [x] Détection de cycles et d'alias brisés (+ suggestion fuzzy).
- [x] Affichage raw + resolved + chaîne dans l'inspector.
- [x] **Chips d'alias** dans le tableau (icône type + path).
- [x] Autocomplétion des paths dans l'éditeur d'alias (datalist natif ; overlay CDK = amélioration future).
- [x] Rename safe avec propagation des références (atomique multi-fichiers).
- [x] Recherche full-text (MiniSearch) + filtres (alias/deprecated/orphans/errors).
- [x] Command Palette (⌘K).
- [x] Diagnostics avec quick-fixes (broken-alias → remplacement).

**Critère de sortie** : renommer un token de base utilisé par 50 alias indirects, sans rien casser, en moins de 5 secondes UI inclus.

### Phase 3 — Multi-mode, multi-brand, composites (≈ 4 semaines)

**Objectif** : couvrir la thématisation et les types riches.

- [ ] Support complet de `$extends`.
- [~] Stratégies de modes : **B (fichiers par thème)** et **modes inline / dimension de chemin** faits ; `$extends` (A) + normalisation à l'écriture restants.
- [x] **Modes en colonnes** dans le tableau (modeLight/modeDark + thèmes par fichier détectés via manifest/auto).
- [x] **Ajout / renommage / suppression / duplication de mode** — système unifié robuste sur les **3 stratégies de stockage** (détection auto par collection) : **fichier** (1 fichier/thème) → ajout/dup = copie d'un fichier source, renommage = relibellé config (fichiers conservés), suppression = désenregistre le mode (le `.json` est laissé sur disque) ; **dimension de chemin** (modeLight/modeDark…) → ajout/dup = clone du sous-arbre du segment, renommage = renommage du segment (ordre préservé), suppression = retrait du sous-arbre ; **inline** (`$value:{light,dark}`) → ajout/renommage/suppression de la clé `$value` ; **mono-mode** → l'ajout convertit en inline. Le dernier mode ne peut pas être supprimé. **UI** : `+` (icône SVG agrandie) dans l'en-tête du tableau = popover (nom + « copier depuis » un mode source, façon Figma) ; **double-clic** sur un en-tête de colonne = renommage inline ; **clic** = sélection de la colonne (surbrillance) puis **Suppr/Delete** = suppression ; **clic droit** = menu Rename / Duplicate / Delete. Endpoints `POST /api/modes/{add,rename,delete,duplicate}` (atomiques, rollback ; ops structurelles → réinitialisent l'undo byte-exact). **Fix fiabilité** : l'édition d'une valeur par mode sur une collection fichier-modes écrit désormais dans **le fichier du bon mode** (avant : toujours le 1er). Vérifié de bout en bout (HTTP + UI preview sur copie des primitives PrimeNG : +/select/Delete/clic-droit/dup, 0 erreur console).
- [x] **Éditeurs dédiés composites** (`typography`, `shadow`, `border`, `transition`, gradient-stops) : éditeur *expand-in-place* **typé par sous-propriété** (mapping `compositeFieldType` dans `core/format.ts`). Chaque sous-valeur **couleur** a une **pastille** (ouvre le color picker Custom) **et** un bouton **lien** ; chaque sous-valeur **métrique** (dimension/number/duration) a un bouton **lien** → ouvre le **picker Libraries filtré par type** pour poser un alias `{path}`. L'alias est écrit dans la sous-propriété du `$value` et **résolu récursivement** par le resolver (vérifié live : `shadow.card.offsetX = {size.sm}` → résout `1rem`, et le picker d'une sous-valeur couleur ne liste que des tokens couleur). Réutilise le `CellPickerService` via un callback `onPick`. **Ouverture** : icône d'édition dédiée dans la cellule **+** simple clic (le double-clic seul n'était pas découvrable) ; la cellule affiche la forme **brute** (les sous-propriétés aliasées restent `{path}`, pas leur valeur résolue). Icône de type `shadow` = `❏`. Types **scalaires** (`duration`, valeur `cubicBezier`, `strokeStyle`) : édités/aliasables directement en cellule (lien d'alias déjà en place). **Gradient** (`$value` = array de stops, conforme DTCG) : éditeur de stops dédié — preview `linear-gradient`, pastille couleur + lien d'alias par stop, position `0–1`, add/remove → réassemble `[{color, position:number}]`. [ ] shadow **multi-couches** (array de shadows) : édition par-couche — encore mono-objet.
- [ ] Color picker OKLCH custom + gamut indicator (sRGB / P3). _(picker actuel = sRGB hex/RGB/HSV ; OKLCH + gamut = passe dédiée, nécessite `culori`.)_
- [x] **Détection d'overrides incomplets** : un token multi-mode qui définit certains modes mais pas tous lève un diagnostic **warning** `incomplete-mode-override` (le mode manquant hérite silencieusement du défaut). Émis dans `resolver.ts` (uniquement si la collection a ≥2 modes). Tests `resolver.test.ts`.
- [ ] Virtualisation CDK pour tableaux > 200 lignes. _(table groupée + drag-drop + scroll horizontal ; intégration CDK virtual-scroll = passe dédiée, géométrie sensible.)_

**Critère de sortie** : gérer un design system multi-brand (3 marques × 3 thèmes) sans duplication et avec preview visuel live, sur une base de 1000+ tokens fluide.

### Phase 3.5 — Édition fluide façon Figma Variables (≈ 2–3 semaines, prioritisable)

**Objectif** : supprimer la friction du « clic sur Save token par token ». L'édition doit se faire **directement dans le tableau**, au clavier, comme le panneau Variables de Figma. Phase intermédiaire : peut être avancée avant la Phase 4 car elle n'a pas de dépendance forte.

**Problème actuel** : chaque modification passe par l'inspector + un bouton « Save » par token et par mode → fastidieux sur des dizaines de valeurs.

#### 3.5.1 Édition inline dans les cellules — ✅ FAIT
- [x] Cellule éditable au **clic** : input in situ, sans ouvrir l'inspector.
- [x] **Auto-save** au `blur` et sur `Enter` — plus aucun bouton Save par token.
- [~] Mise à jour optimiste : refresh rapide après écriture ; toast/rollback fin → à peaufiner.
- [ ] Indicateur « dirty » discret par cellule tant que l'écriture n'est pas flushée.

#### 3.5.2 Navigation clavier — ✅ FAIT (base)
- [x] `Tab` / `Shift+Tab` : colonne de mode suivante/précédente.
- [x] `Enter` : commit + descend d'une ligne ; `Esc` : annule.
- [x] `↑/↓/←/→` pour se déplacer entre cellules (cellule active focusable, ring), `Enter`/`F2` édite ; `Cmd/Ctrl+C/V` copie/colle la valeur brute (coller sur une multi-sélection → batch = 1 item).
- [x] Autocomplétion d'alias (datalist) ; [ ] popover ancré navigable au clavier (amélioration).

#### 3.5.3 Écritures groupées (transactionnel) — ✅ FAIT (deprecate restant)
- [x] Endpoint `PATCH /api/tokens/batch` : applique N changements de valeur **en un seul flush par fichier**, validation atomique (tout ou rien), **un seul item d'historique** (`updateValuesBatch`).
- [x] Coalescing des éditions rapides d'une **même cellule** en un item (fenêtre 700 ms, via le `CommandStack` 3.6).
- [x] Multi-sélection + **actions de masse** : **définir une valeur** (coller sur N lignes → batch), **supprimer** et **déplacer** (déjà via menu contextuel / drag). [ ] marquer `deprecated` en masse (nécessite une mutation `metadata` — à faire).

#### 3.5.4 Drag & drop des lignes (parité panneau Variables de Figma)

Comportement cible : on saisit une (ou plusieurs) **ligne(s) du tableau** par une poignée et on les fait glisser pour les réordonner ou les changer de groupe, exactement comme dans Figma.

- [x] **Drag d'une ligne de token** : réordonner au sein du même groupe (réécriture de l'ordre des clés JSON, structure/format préservés).
- [x] **Déplacer une ligne dans un autre groupe** (drop sur la liste d'un autre groupe) → move/rename sûr avec propagation des références.
- [x] **Multi-sélection de lignes** (clic, `Cmd/Ctrl+clic`, `Shift+clic`) + drag groupé (badge « N variables »). [ ] `Cmd/Ctrl+A`.
- [x] **Poignée de drag** (`⠿`) au survol (sépare drag, édition inline et sélection).
- [x] **Indicateur de drop** : ligne noire d'insertion (`*cdkDragPlaceholder`) + animation fluide, dans le tableau ET la sidebar.
- [x] **Drag & drop dans la sidebar** : réordonner les groupes frères d'un niveau.
- [x] **Re-imbrication de groupes** : déplacer un groupe ENTIER dans un autre parent/niveau (`POST /api/groups/move`, drag sidebar cross-niveaux via `GroupDropRegistry`). ⚠️ Échoue sur collections mode-repliées (cf. PROBLÈME #1).
- [x] Le déplacement / copier / couper-coller multi-sélection = **un seul item d'historique** (`POST /api/tokens/move` → `moveTokensBatch` → `applyRenamesAtomic`, atomique tout-ou-rien, label « Move N variables »). Vérifié : 2 tokens déplacés = 1 item, un seul undo rétablit le lot (byte-exact).

**Backend** : `POST /api/tokens/reorder` (FAIT, ordre des clés) + move multi via `POST /api/tokens/move` (FAIT, batch 1 item) ; move unitaire via `POST /api/tokens/:id/rename` (FAIT). LIMITE : clés **numériques** (échelles `"50"/"900"`) non réordonnables (JSON sérialise les clés entières en ordre croissant). TODO : endpoint `move` de groupe entier.

#### 3.5.6 Tableau groupé par chemin de groupe complet (parité Figma) — ✅ FAIT

- [x] Lignes groupées par **parent complet** (`path.slice(0,-1)`) avec **en-tête breadcrumb** (« token / actions / high / **content** », dernier segment en gras + compteur).
- [x] En-têtes **sticky** au scroll ; chaque section = un `cdkDropList` (reorder = vrais frères directs → fiabilise 3.5.4).
- [x] Détection auto de la dimension de mode (modeLight/modeDark) même pour les collections sans modes déclarés → modes en **colonnes** et segment de mode retiré du breadcrumb (comme Figma).
- [~] La sélection d'un groupe dans la sidebar filtre déjà la table (préfixe de chemin) ; scroll-to-section = amélioration future.

> ⚠️ **PROBLÈME #1 (prioritaire)** — sur les collections **mode-repliées** (segment de mode → colonnes), le chemin logique ≠ chemin physique sur disque. `updateValue` est corrigé (traduction logique→physique via `modeDims`). `reorder`/`moveGroup`/`moveTokens` ne sont **pas encore** traduits → échouent sur ces collections. À corriger en priorité.

#### 3.5.5 Édition rapide spécifique par type — ✅ FAIT
- [x] Color : swatch cliquable → color picker en popover dans la cellule (input natif `type=color` + champ hex/css libre, Apply/Cancel/Esc, backdrop).
- [x] Dimension/number : steppers ▲▼ + `↑/↓` incrémente/décrémente (Shift = ±10), unité préservée. Commit au blur/Enter (coalescé en 1 item d'historique).
- [x] Composites : éditeur « expand-in-place » en popover — chaque sous-propriété de `$value` éditable, types `number` préservés, réécriture de l'objet entier via `updateValue`. Vérifié sur `examples/multimode/tokens/typography.json`.

#### 3.5.7 Création de variables (Create variable) — ✅ FAIT

- [x] **Toolbar** : bouton `+ Create variable` + **dropdown de type** (les 13 types DTCG, avec glyphe). Crée la variable dans le **groupe actif** (filtre sidebar) sinon à la **racine**.
- [x] **Divider de groupe** (en-tête de section du tableau) : un `+` discret (au survol) ajoute une variable **dans ce groupe**, **type inféré** des rows du groupe (fallback `color`).
- [x] **Renommer un groupe depuis le divider** : double-clic (ou crayon) sur l'en-tête → vrai groupe renommé (`renameGroup`, propagé). Le divider racine `(root)` → **« Ungrouped »** ; le renommer **déplace les variables racine dans un nouveau groupe** nommé (`moveTokensToParent`), désormais **visible dans la sidebar**.
- [x] **Valeurs par défaut par type** (`defaultValueForType`, `web/core/format.ts`) — une valeur cohérente par type scalaire/composite, clonée par mode.
- [x] **Flux Figma-like** : la ligne créée est sélectionnée et passe **directement en renommage inline** (`pendingRenameTokenId`).
- [x] **`createToken` serveur mode-aware** (corrige une régression cachée) : écrit selon la stratégie de stockage de la collection — `dimension` (nœud par mode au chemin physique), `file` (un nœud par fichier-mode), `inline` (`$value:{mode:…}`), `none` (scalaire). Avant : toujours inline → cassé sur dimension/file. Test `project.test.ts` + vérif live (toolbar + `+` de groupe, valeurs par mode correctes, 0 erreur console).

**Dépendances** : s'appuie sur le store de Commands réversibles (mutualisé avec l'Undo/Redo de la Phase 4) et sur la virtualisation CDK (Phase 3) pour rester fluide.

**Critère de sortie** : éditer 50 valeurs à la suite uniquement au clavier (Tab/Enter), sans jamais cliquer « Save », avec un `git diff` propre ne montrant que les valeurs changées ; réordonner un groupe par drag and drop persiste l'ordre dans le JSON.

### Phase 3.6 — Undo / Redo robuste — ✅ FAIT (≈ 1–2 semaines, prioritisable)

> **Implémenté.** `CommandStack` byte-exact côté serveur (`packages/server/src/history.ts`) ; toutes les mutations (edit, create, delete, rename, reorder, move/rename group, delete/duplicate group/token) capturent before/after par fichier. Endpoints `POST /api/undo`, `POST /api/redo`, `GET /api/history` (+ `history` exposé dans `GET /api/state`). UI : boutons ↶/↷ dans le header (tooltip = prochain label), raccourcis `⌘Z`/`Ctrl+Z` + `⌘⇧Z`/`Ctrl+Y` (ignorés en champ texte), toast après chaque undo/redo. Anti-désync : comparaison du contenu disque au snapshot ; confirmation `force` si divergence. Coalescing des éditions rapides d'une même cellule (fenêtre 700 ms). **Drag multi-sélection = 1 item** : endpoint batch-move `POST /api/tokens/move` (`moveTokensBatch` → `applyRenamesAtomic`). Tests : 4 cas dans `project.test.ts` (byte-exact, coalescing, anti-désync, redo-clear) ; vérifié live (edit→undo→redo→undo, byte-clean).

**Objectif** : `⌘Z` / `Ctrl+Z` (annuler) et `⌘⇧Z` / `Ctrl+Y` (rétablir) **fiables et exacts**, comme un vrai gestionnaire de tokens. Détaille et remonte en avance le point « Undo/Redo » jusqu'ici listé en Phase 4.

**Principe de fiabilité — historique au niveau fichier (byte-exact)** :
chaque mutation (édition de valeur, create, delete, rename, move, reorder, quick-fix, batch) est encapsulée dans une **Command** qui mémorise, pour **chaque fichier touché**, son **contenu avant** et son **contenu après**. Undo = réécrit les contenus « avant » ; Redo = réécrit les contenus « après ». C'est indépendant de la sémantique de l'opération → **restauration exacte garantie** (ordre des clés, formatage, références), impossible à désynchroniser.

#### 3.6.1 Pile de Commands côté serveur — ✅ FAIT
- [x] `CommandStack` en mémoire (taille bornée, défaut 100) : `undoStack` / `redoStack` de Commands `{ id, label, changes: [{rel, before, after}], timestamp, tokenId?, coalesceKey? }` (`packages/server/src/history.ts`).
- [x] Toute mutation existante pousse une Command (capture avant/après des fichiers **réellement** modifiés, via les chemins d'écriture centralisés `commitFile`/`renameToken`/`applyRenamesAtomic`/`reorderTokens`/`commitStaged`/`updateValuesBatch`/`copyTokenTo`).
- [x] Une nouvelle mutation vide la `redoStack` (branche linéaire).
- [x] Endpoints `POST /api/undo`, `POST /api/redo`, `GET /api/history` (+ `history` dans `GET /api/state`).

#### 3.6.2 Granularité & coalescing — 🟡 PARTIEL
- [x] Un **rename en cascade** = 1 item ; un **move/rename de groupe multi-fichiers** = 1 item.
- [x] Un **drag multi-sélection** = **1 item** (endpoint batch-move `POST /api/tokens/move` → `moveTokensBatch`, regroupe N renames en une seule Command via `applyRenamesAtomic`).
- [x] Éditions rapides **sur la même cellule** coalescées (fenêtre 700 ms, `coalesceKey = v:id:mode`).
- [x] Les écritures groupées (batch 3.5.3 `updateValuesBatch`, et le copier/coller de valeur multi) forment un item unique.

#### 3.6.3 Sûreté face au disque (anti-désync) — ✅ FAIT
- [x] Avant un undo/redo, comparaison du **contenu disque** au snapshot attendu (after pour undo, before pour redo) ; si divergence → `409 diverged`, l'UI **demande confirmation** (`force`) au lieu d'écraser.
- [x] Après undo/redo : reparse + ré-émission WebSocket (UI synchronisée) + re-sélection du token concerné (`UndoRedoResult.tokenId` → `revealTokenById`).
- [x] Non persisté sur disque (la mémoire longue durée reste Git).

#### 3.6.4 Intégration UI — ✅ FAIT
- [x] Raccourcis globaux `⌘Z`/`Ctrl+Z` → undo, `⌘⇧Z`/`Ctrl+Y` → redo (ignorés en champ texte / éditeur de cellule).
- [x] Signals d'historique (`ProjectStore`) : `canUndo`, `canRedo`, `undoLabel`, `redoLabel` (dérivés de `state().history`) ; boutons ↶ / ↷ dans le header avec tooltip du prochain label. [ ] Panneau-liste de l'historique (la pile + curseur sont exposés par `GET /api/history` mais pas affichés comme liste — amélioration future).
- [x] Toast discret après chaque undo/redo (« Undone: … » / « Redone: … »).

**Dépendances** : mutualise le mécanisme avec le drag multi-sélection et le batch (3.5) ; remplace le point Undo/Redo de la Phase 4.

**Critère de sortie** : enchaîner 10 opérations hétérogènes (éditions, rename en cascade, move multi-sélection, reorder), puis 10× `⌘Z` ramène le projet **byte-pour-byte** à l'état initial (`git diff` vide), et 10× `⌘⇧Z` le rétablit à l'identique.

### Phase 3.7 — Robustesse du typage des tokens (planifiée)

**Objectif** : fiabiliser la connaissance du **type** d'un token, car les fichiers JSON ne déclarent pas toujours `$type`. L'inférence depuis une valeur littérale marche déjà (`inferType` : `#fff`→color, `16px`→dimension, `200ms`→duration, nombre→number), **mais un token dont la valeur est un alias n'a pas de type inférable → `unknown`**, ce qui dégrade le filtrage par type (picker « Libraries », autocomplete), la validation et le choix d'éditeur. Constaté en réel (PrimeNG) : une cellule aliasée vers `metrics/units/default` proposait des alias **couleur**.

**Palliatif déjà en place (UI)** : `effectiveType()` (`web/core/format.ts`) infère le type d'une cellule `unknown` depuis sa **valeur résolue**, et un regroupement en familles (`numeric` = number/dimension/duration) sert au filtrage. À consolider côté serveur :

- [ ] **Type effectif côté serveur** : calculer et exposer dans `ParsedToken` un `effectiveType` = `$type` déclaré → sinon inféré de la valeur → sinon **inféré de la valeur résolue** (suivre la chaîne d'alias). Source unique de vérité pour filtrage/validation/éditeurs (UI + API).
- [ ] **Inférence par cohérence de groupe** : si tous les enfants d'un groupe partagent un type, l'attribuer au groupe (et aux nouveaux enfants).
- [ ] **Déclarer / forcer le type** depuis l'inspector (écrit `$type` sur le token ou le groupe) — utile quand l'inférence est ambiguë.
- [ ] **Diagnostics de cohérence de type sur les alias** : un alias vers une cible de type incompatible (ex. dimension → color) lève un diagnostic.
- [ ] **Validation par type effectif** : valider les valeurs selon le type effectif plutôt que le seul `$type` déclaré.

**Critère de sortie** : sur une base sans `$type` (type PrimeNG), une cellule numérique (même aliasée) ne propose que des tokens numériques, une cellule couleur que des couleurs ; les incompatibilités de type d'alias sont signalées.


## Phase 4 — Compagnon de Configuration & Distribution (Style Dictionary v5)

> **Statut** : backend **v5 ✅** (générateur `generateV5Script` + test build sandboxé `runTestBuild` + détection version), UI **v1 livrée** (assistant 4 étapes) → **à SIMPLIFIER** vers le **modèle 3 états** ci-dessous (accueil 2 choix · assistant 3 étapes qui *écrit* config+script · résumé+test). On abandonne l'édition bidirectionnelle/détection ambitieuse. Maquette de référence : rendu visuel de cette session. Détails : [CHANGELOG.md](CHANGELOG.md) (2026-06-20).
>
> **Pourquoi un redesign** : (1) on veut proposer la **dernière version de Style Dictionary (v5, DTCG-native)** aux nouveaux projets, pas la v3 ; (2) l'UI actuelle (onglets de champs bruts : exportPrefix, buildPath, mode…) **n'est pas parlante pour un novice** ; (3) les pipelines réels sont une **matrice** : *une source de tokens → plusieurs cibles* (ex. CSS **et** TS) **stockées à des emplacements différents**, et *chaque collection a sa propre stratégie de theming* (primitives multi-fichiers de marque, collection responsive desktop/tablet/mobile, collection mono-thème…). L'outil doit **accompagner** ce choix, pas exposer un fichier de config brut.

### Vision — un **configurateur**, pas un éditeur de config

Token Flow Manager **édite des tokens** ; cette feature aide juste l'utilisateur à **initier** ou **visualiser** sa conversion Style Dictionary, simplement. On **arrête de deviner / d'éditer des configs arbitraires de façon bidirectionnelle** (trop ambitieux, fragile). À la place : un configurateur à **3 états simples**, qui produit de **vrais fichiers** que le projet possède.

> **Simplification (2026-06-20, suite)** : remplace l'« assistant 4 étapes + matrice en localStorage + détection v3/v5 » par le modèle ci-dessous. Maquette de référence : voir le message de cette session (rendu visuel).

### Les 3 états

1. **Pas configuré** — pas de commande/config de build détectée → écran d'accueil avec **2 choix** :
   - **« Configurer la conversion »** (recommandé) → l'assistant de création.
   - **« J'ai déjà ma config »** → on **pointe** le fichier de config + la commande de build (ex. `npm run generate:tokens`) ; aucun parsing/édition. Mène à l'état 3.
2. **Assistant de création** — 3 étapes explicites, en langage clair, qui à la fin **écrit les fichiers** :
   - **① Variantes** : une ligne par collection avec ses **variantes détectées (noms)** sous forme de chips éditables — modes (`light/dark`, `desktop/tablet/mobile`, ou **n'importe quoi** : `compact/comfortable`…) **ou** fichiers de thème. **On ne devine PAS la sémantique** ; on liste juste les noms (corrigeables si une détection est fausse). Une collection peut être « aucune variante ».
   - **② Sorties** : une ou plusieurs **cibles** (presets Variables CSS, SCSS, SCSS map, TypeScript, JS, JSON), chacune avec **dossier distinct** + **préfixe**. Pour chaque collection-à-variantes, une **stratégie de rendu générique** (par collection × cible) : **Sélecteurs** (map variante→sélecteur) · **Media queries** (map variante→condition) · **Fichiers séparés** (1 fichier/variante) · **Un seul** (merge / variante par défaut). **Pré-rempli** par heuristique de noms (`light/dark`→sélecteurs `:root`/`[data-theme]` ; `desktop/tablet/mobile`→media-queries ; sinon→fichiers séparés) mais **tout est éditable** → marche pour des modes arbitraires.
   - **③ Vérifier & créer** : aperçu des fichiers écrits (config + script + script npm) → **Créer** → écrit `tokens.config.mjs` (ou `.json`) + `scripts/tokens.build.mjs` + script npm. Puis état 3 + test build.

   **Principe clé** : une collection a des **variantes nommées** (détectées), pas une « nature » devinée. Le **rendu** est une **stratégie générique** choisie **par (collection × cible)** — donc différente d'un format à l'autre (ex. `semantic` → Sélecteurs en CSS mais objet imbriqué en TS ; `responsive` → Media queries en CSS, objet par breakpoint en TS). Les 4 stratégies couvrent tous les cas sans présumer du sens des modes.

   | Stratégie (par collection × cible) | Effet CSS / SCSS vars | Effet TS / JS |
   |---|---|---|
   | Sélecteurs | un bloc par variante, sélecteur mappé (`:root`, `[data-theme]`, `.x`…) | (n/a → bascule en objet imbriqué) |
   | Media queries | un `@media` par variante, condition mappée | (n/a → objet par variante) |
   | Fichiers séparés | un fichier par variante (suffixe = nom) | un fichier/objet par variante |
   | Un seul | à plat (variante par défaut ou merge) | à plat |

   > **Conséquence générateur** : piloter le rendu **par (sourceId × targetId) → stratégie + mapping**, plus de `variant` globale de cible. `generateV5Script` doit : (a) recevoir, par source, la **liste de variantes nommées** ; (b) par cible, une **stratégie + mapping** par source (avec défauts heuristiques côté UI) ; (c) émettre sélecteurs / media-queries / fichiers / objets en conséquence. **À ajouter** : media-queries + fichiers/classes par variante générique (il fait déjà sélecteur / file-per-theme / merge).
3. **Configuré** — **résumé** lisible du pipeline (sources → theming → cibles, avec dossiers) + actions : **Tester le build** (rapport concis), **Modifier** (rouvre l'assistant), **Ouvrir les fichiers**.

### Génération Style Dictionary **v5** (inchangé sur le fond)

- **DTCG-native** (`$value`/`$type` directs, `expand` pour les composites). Le wrap des sources sous leur namespace (pour résoudre `{primitives.x}`) est **automatique**. Le **rendu des variantes** suit la **stratégie choisie par (collection × cible)** (Sélecteurs / Media queries / Fichiers séparés / Un seul) + mapping — pré-rempli par heuristique de noms, pas de sémantique devinée. Générateur : `generateV5Script` (`packages/server/src/distribution-v5.ts`) — **à faire évoluer** vers ce rendu par (collection × cible) + media-queries/fichiers-par-variante.
- **Test build** : passe réelle en sandbox jetable (le projet n'est jamais écrit) → rapport `{ ok, fichiers produits, diagnostics }`. Déjà implémenté : `runTestBuild`.
- **Projets v3 existants** (ex. primeng-theme-starter) : reconnus via l'état « J'ai déjà ma config » → on affiche le résumé + on lance **leur** commande pour le test ; pas de réécriture.

### Ce qui change vs l'implémentation actuelle

L'assistant 4 étapes livré (Sources/Theming/Cibles/Build + matrice localStorage) est **simplifié** : suppression de l'étape abstraite « Sources / wrap-under / source-root » (auto-déduite du theming), ajout de l'**écran d'accueil 2 choix** et de l'**écran de résumé**, et **écriture réelle** du config + script à l'étape « Créer » (au lieu d'une matrice en localStorage). Le générateur v5 + test build (backend) restent tels quels.

### Phase 4.1 — Modèle & détection — ✅ socle / 🔁 à étendre
- [x] Détection du manifest + collections (réutilisé comme « sources »).
- [x] Round-trip d'écriture sûr (merge des clés inconnues).
- [ ] **Schéma manifest v5** : `sources[]` (files + theming `single|themes|modes`), `targets[]` (preset, format, destination, prefix, appliesTo, stratégie de variante), `sdVersion`.
- [ ] Pré-remplissage du manifest à partir de la détection (theming inféré des modes/fichiers de chaque collection).

### Phase 4.2 — Wizard d'Initialisation ("Zéro Config") — ✅ socle / 🔁 retarget v5
- [x] Scaffolding atomique (manifest + script + npm) — backups, idempotent.
- [ ] **Presets v5** (CSS variables, SCSS, TS/JS constants) générant une **config/script SD v5** (ESM, DTCG-native, `expand` pour les composites).
- [ ] Générateur de **build script v5** qui matérialise la matrice (boucle source × variante × cible) — remplace le template v3 pour les nouveaux projets.

### Phase 4.3 — Assistant Visuel (UI) — ✅ assistant 3 étapes (modèle générique)
- [x] **Modèle de variantes générique par (collection × cible)** : collection = **variantes nommées** (`{name, file?}`) ; cible = **stratégie + mapping** par collection (`Sélecteurs / Media queries / Fichiers séparés / Un seul`). Remplace `theming` (nature devinée) **et** `variant` globale. `shared/distribution.ts` + générateur `distribution-v5.ts` réécrits ; **vérifié en réel** (sélecteurs/media/objets corrects sur PrimeNG).
- [x] **Assistant 3 étapes** : **Variantes** (chips de noms détectés, éditables, faux-positifs retirables) → **Sorties** (cibles + stratégie par collection auto-dérivée des noms + mapping variante→valeur) → **Build & test**. `features/distribution/distribution.component.ts`. Vérifié live (test build ✓, 0 erreur console).
- [ ] **Écran d'accueil 2 choix** (état 1) : « Configurer la conversion » vs « J'ai déjà ma config » (pointer fichier + commande).
- [x] **Écrire les fichiers à « Enregistrer le build »** : `scripts/tokens.build.mjs` (script v5 auto-suffisant) + script npm `tokens:build` + matrice persistée dans `.tokenflow/distribution.json` (`POST /api/distribution/write`). `getDistribution` restaure `savedMatrix`/`v5ScriptPath`. Le script écrit **build réellement** en standalone (vérifié). Plus de dépendance au localStorage seul.
- [ ] **Écran de résumé** (état 3 configuré) : pipeline + Tester le build / Modifier / Ouvrir les fichiers.
- [ ] **Lien « config existante »** : enregistrer chemin config + commande ; test = lancer leur commande.
- [ ] _Plus tard_ : preview Monaco, diagnostics cliquables, sélection des sources par cible (aujourd'hui `all`).

### Phase 4.4 — Test Build & Rapport — 🟡 Backend ✅ / UI ⬜
- [x] **Runner de test build** (`runTestBuild`, `packages/server/src/distribution-v5.ts`) : génère le script v5 de la matrice, l'exécute dans un **sandbox jetable** (node_modules symlinké vers notre SD v5, sortie écrite dans le sandbox → **le projet n'est jamais touché**), lit les **vrais** tokens via un `sourceRoot` absolu, et renvoie un `DistBuildReport` `{ ok, outputs:[{target,file,bytes}], diagnostics:[{level,message,token?,theme?}], durationMs }`.
- [x] **Diagnostics pratiques** : SD v5 lancé en `verbosity:'verbose'` + `errors:{brokenReferences:'console'}` (non-fatal) → les **références non résolues** (« {x} tries to reference {y}, which is not defined »), collisions et warnings sont **captés** (stdout+stderr), dédupliqués, le bruit (chemins sandbox) filtré ; une réf cassée fait passer `ok:false`. Endpoint `POST /api/distribution/test-build`. **Vérifié** : set propre → `ok:true` + fichiers ; réf cassée → `ok:false` + diagnostic erreur ciblé.
- [x] **Bouton « Tester le build » + rendu du rapport** dans l'UI (étape ④) : badge ok/durée, panneau diagnostics (chips erreur/warning, ANSI strippé) + panneau fichiers produits (cible + chemin + taille). Vérifié live.
- [ ] **Preview read-only** du code généré (Monaco) avant écriture réelle.
- [ ] Diagnostics **cliquables** → ouvrir le token concerné (lien vers la table).
- [ ] Projets **v3** : exécuter leur script existant dans le child-process sandboxé (le runner actuel cible la génération v5).

> **Décisions à arbitrer** (4.x) : (a) v5 = **config seule** vs **script ESM** selon complexité (recommandé : script dès qu'il y a une matrice) ; (b) intégrer **`@tokens-studio/sd-transforms`** pour les bases Tokens Studio / l'expansion ; (c) **conversion assistée v3→v5** des projets existants ; (d) **multi-version** : détecter la version de SD du projet et générer en conséquence.

## Phase 5 — Intégration Git (lecture seule, non-intrusive) — ⬜ À FAIRE

> **Statut** : ⬜ **non implémentée**. Spécifiée fonctionnellement en **§4.6** et **§6.2** (edge cases), mais aucun code à ce jour (pas d'usage de `simple-git`, pas d'endpoint `/api/git`). La maquette du layout (§5.2) montre déjà le footer « X files modified (Git) » : c'est une **cible**, pas un acquis.
>
> **Note packaging (2026-06-23)** : `simple-git` (la lib pressentie en §2.2) **a été retirée des dépendances** du CLI/serveur pour la v0.1.0 — c'était une **dépendance morte** (déclarée, jamais importée) qui alourdissait inutilement le package npm publié. À **ré-ajouter** quand cette phase démarre.

**Objectif** : le manager **informe** sur l'état Git du working tree sans jamais le muter. Il ne commit/merge/push/pull **jamais** — la mémoire longue durée reste Git, géré par le développeur dans son outil habituel. Rappel §1.2 : « Intégration Git non-intrusive ».

### 5.1 Détection & état (socle)
- [ ] Détection du dépôt Git (remontée depuis le cwd jusqu'au `.git`).
- [ ] État du working tree **par fichier de tokens** : `clean` / `modified` / `untracked` / `staged`.
- [ ] Indicateur global dans le footer : « X fichiers modifiés · Y tokens impactés » (déjà maquetté §5.2).
- [ ] Endpoint `GET /api/git/status` + push WebSocket à chaque changement détecté par le watcher (le statut se rafraîchit quand l'utilisateur édite ou pull en externe).

### 5.2 Diff & discard
- [ ] **Diff visuel** des modifications en cours vs `HEAD` (Monaco diff editor, cf. §5.8).
- [ ] **Discard local changes** sur un fichier (`git checkout -- <file>`), derrière une **confirmation forte** (action destructive, seule mutation Git tolérée car restauratrice).
- [ ] Badge par fichier/collection dans la sidebar et l'inspector (pastille « modifié »).

### 5.3 Conflits de merge (détection passive)
- [ ] Si le watcher voit apparaître des markers `<<<<<<<` dans un fichier de tokens → le fichier passe **en lecture seule**, badge « Conflit », invite à résoudre dans l'IDE (cf. §6.2).
- [ ] Aucune résolution automatique ; rechargement auto à la sauvegarde une fois résolu.

**Critère de sortie** : sur un projet sous Git, éditer 3 tokens → le footer indique « 1 fichier modifié », le diff vs `HEAD` ne montre que les valeurs changées, et « Discard » restaure le fichier byte-pour-byte ; introduire un marker de conflit → le fichier passe en lecture seule avec le badge « Conflit ».

## 8. Décisions techniques à arbitrer

1. **Préservation du formatage JSON** : indentation existante, ordre des clés, lignes vides — décision : on garde l'ordre des clés et l'indentation détectée, on ne tente pas de préserver les commentaires.
2. **Mode JSON5/JSONC** : autoriser les commentaires en lecture, normalisation en pur JSON à l'écriture avec avertissement.
3. **Stratégie de port** : auto avec fallback, plus un fichier `.tokenflow/last-port` pour réouvrir au même endroit.
4. **Télémétrie** : aucune par défaut. Si jamais utile plus tard, opt-in explicite.
5. **Auth locale** : un token aléatoire passé en query string lors de l'ouverture du browser.
6. **Spartan-ng vs custom** : évaluer Spartan-ng en phase 1 (gain de temps initial) ; basculer en composants custom si verrouillages stylistiques rencontrés.

---

## 9. Risques identifiés

| Risque | Impact | Mitigation |
|---|---|---|
| Spec DTCG encore évolutive | Refactor de modèle | Abstraire les types DTCG derrière un schéma versionné, supporter explicitement `2025.10` puis incrémenter. |
| Corruption de fichier utilisateur | Critique | Écriture atomique + backups + validation pré-écriture systématique. |
| Performance sur très gros projets (>10k tokens) | UX dégradée | Indexation incrémentale, CDK VirtualScroll, profiling dès la Phase 1. |
| Confusion entre modes/collections/fichiers | Adoption | UX : modes en colonnes (visuels en permanence), breadcrumb collection › groupe › token, onboarding au premier lancement. |
| Conflits avec Token Flow (IDE) et Token Forge (Figma) | Cohérence écosystème | Définir tôt un protocole de communication local commun aux trois outils. |
| Spartan-ng moins mature que shadcn/ui React | Composants à refaire | Garder l'option custom dès le départ, Tailwind reste la couche stable. |

---

## 10. Versioning & distribution (prise en main)

### 10.1 Système de version

- **Source d'affichage** : `packages/web/src/app/core/version.ts` (`APP_VERSION`), affichée dans le footer et le modal d'aide.
- **Convention** : semver (`MAJOR.MINOR.PATCH`). `CHANGELOG.md` tenu à jour à chaque release.
- **Process de release** : bump `APP_VERSION` **et** `packages/cli/package.json` (versions alignées), entrée CHANGELOG, tag git. _Amélioration possible_ : un petit script `scripts/release.mjs` qui synchronise les deux + génère le tag, ou injection de la version `package.json` dans le build pour supprimer toute dérive.

### 10.2 Distribution & onboarding — simplifier le lancement

**Constat.** L'outil = un serveur Fastify local qui sert la SPA Angular et lit/écrit les fichiers de tokens du projet ciblé. Frictions actuelles : (1) deps workspace non bundlées → `ERR_MODULE_NOT_FOUND` (ex. `open`), (2) build manuel, (3) chemin du projet passé en ligne de commande.

**Réponse courte : oui, c'est réaliste sans gros chantier.** La fondation (serveur local + SPA + CLI `bin`) est déjà la bonne. Deux étapes par effort croissant.

#### Étape A — CLI installable + écran d'ouverture de projet ⭐ (effort faible-moyen, recommandé)

Objectif : `npm i -g token-flow-manager` (ou `npx token-flow-manager`) puis `tokenflow` ouvre le navigateur sur un **écran d'accueil** où l'on choisit le projet — **plus aucun chemin en CLI**.

1. **Bundle autonome du CLI** : `tsup` avec `noExternal` (inclure `@tokenflow/server`, `@tokenflow/shared` et les deps comme `open`) → un seul `dist/cli.js`. Embarquer la SPA buildée (`packages/web/dist`) dans le package publié (champ `files`). _Corrige aussi l'erreur `open` déjà rencontrée._
2. **Publier** sur npm (ou tarball). `bin` (`tokenflow`) déjà défini.
3. **Démarrage sans chemin** : si aucun projet, le serveur démarre « à vide » et la SPA affiche un écran d'accueil :
   - **Projets récents** (persistés côté serveur, `~/.token-flow-manager/recent.json`).
   - Bouton **« Ouvrir un projet »** → champ chemin + **navigateur de dossiers servi par le serveur** (`GET /api/browse?path=…`, FS local donc accès OK), ou coller/déposer un dossier.
4. **Racine modifiable à chaud** : `POST /api/open { path }` ré-initialise le ProjectManager sur ce dossier (aujourd'hui `root` est figé au démarrage) + recharge l'état + ajoute aux récents.

_Livrable : installation en 1 commande, ouverture 100 % par interface._

#### Étape B — Vraie app desktop (Tauri)

Emballer l'étape A dans **Tauri** : double-clic (.dmg/.app), aucun Node requis, fenêtre native.

**Architecture retenue (dérisquée) :**
- **Sidecar** = le serveur Node compilé en **binaire autonome via `bun build --compile`** (runtime Bun embarqué, ~57 Mo, sans Node). ✅ _Vérifié_ : `pnpm --filter token-flow-manager build:standalone` produit `packages/cli/standalone/{tokenflow, web/}` ; le binaire sert l'API **et** la SPA sans Node (fastify + chokidar OK). `resolveWebDir` résout aussi relativement à `process.execPath` (binaire) et `../Resources/web` (bundle .app).
- **Frontend** = la SPA Angular (`packages/web/dist/web/browser`), bundlée par Tauri (`frontendDist`) et chargée dans le webview.
- **Câblage API** : sous Tauri le frontend a pour origine `tauri://localhost`, pas le sidecar `http://127.0.0.1:PORT`. Rust lit l'URL+token sur la sortie du sidecar et **injecte** `window.__TFM__ = { api, token }` dans le webview ; `ApiService`/`realtime`/`auth` (via `core/runtime.ts` + intercepteur HTTP) lisent ça, sinon retombent sur le relatif `/api` (navigateur/CLI). **Deux conditions indispensables sinon l'accueil ne charge pas** (appel cross-origin + http local) : (1) **CORS** côté serveur (hook `onRequest` en premier, reflète l'`Origin`, répond aux préflights `OPTIONS`) ; (2) **ATS** macOS — `src-tauri/Info.plist` avec `NSAllowsLocalNetworking=true`. ✅ Implémenté + vérifié (connexion ESTABLISHED webview→sidecar).
- **Sidecar Tauri** : nommer le binaire `tokenflow-<target-triple>` (convention `externalBin`) ; le Rust `main.rs` le spawne au démarrage (plugin `tauri-plugin-shell`), attend qu'il réponde, puis charge le frontend.
- **Icônes** : générées depuis `assets/images/pluginIcon.png` via `tauri icon`.

**Statut : ✅ implémenté et vérifié end-to-end** (macOS arm64). `pnpm desktop:build` produit `.dmg` + `.app`. L'app lancée spawn le sidecar, sert l'API (auth active), et le tue à la fermeture (zéro orphelin).

**Checklist Étape B**
- [x] Sidecar autonome (`build:standalone` / `build-tauri-sidecar.mjs`, bun compile) — vérifié sans Node.
- [x] `resolveWebDir` gère binaire compilé + bundle `.app` (`process.execPath`, `../Resources/web`).
- [x] `src-tauri/` : `tauri.conf.json` (frontendDist, externalBin, bundle dmg/app + icônes), `Cargo.toml` (+ `tauri-plugin-shell`), `lib.rs` (spawn sidecar → lit URL+token sur stdout → fenêtre + injection `window.__TFM__` → kill on exit).
- [x] `ApiService`/`auth`/`realtime` lisent `window.__TFM__` (base URL + token) via un intercepteur HTTP + helper `core/runtime.ts`, avec fallback relatif (navigateur/CLI).
- [x] CLI accepte `--token` ; `build-tauri-sidecar.mjs` nomme le binaire `tokenflow-<triple>` (auto, host triple via `rustc -vV`).
- [x] `pnpm desktop:build` → `.dmg` + `.app` (vérifié : lancement, sidecar, API 401-auth, quit propre).
- [ ] Cross-platform : builder sur Windows/Linux pour `.msi`/`.exe`/`.AppImage`.
- [ ] **Signature / notarisation** (macOS `codesign`+`notarytool`, Windows cert) pour éviter l'avertissement Gatekeeper au 1er lancement.

> Electron reste l'alternative (Node natif → pas de sidecar à compiler, mais bundle ~100 Mo). Tauri retenu : `.app` ~ léger, sidecar Bun ~57 Mo.

#### Recommandation

Faire **l'Étape A** maintenant : faible effort, couvre « tous niveaux » (une install, une UI d'ouverture, zéro CLI). Garder **l'Étape B (Tauri)** en option ultérieure pour le confort « vraie app installée ».

**Checklist Étape A**
- [x] `tsup` `noExternal: [/^@tokenflow\//]` (inline les packages workspace) + `scripts/embed-web.mjs` qui copie la SPA dans `dist/web`. Deps tierces déclarées dans `cli/package.json` (corrige `open`).
- [x] `POST /api/open` + `GET /api/browse` + `GET /api/recents` côté serveur ; `root` mutable via la classe `Session` (projet courant remplaçable à chaud).
- [x] Écran d'accueil Angular (`features/welcome`) : projets récents + navigateur de dossiers, affiché quand `state.open === false`.
- [x] Persistance des récents (`~/.token-flow-manager/recent.json`).
- [x] **Préparation de la publication npm (v0.1.0)** : package `token-flow-manager` **autonome vérifié** via `npm pack` (10 fichiers = `dist/cli.js` 268 kB + SPA Angular embarquée ; 238 kB packés). `bin` `tokenflow` **et** `token-flow-manager` fonctionnels (`tokenflow --version` → `0.1.0`, `validate` OK). Packages internes `@tokenflow/*` passés en **`private: true`** (jamais publiés seuls, bundlés par tsup). Dépendance morte `simple-git` **retirée** (CLI + serveur). README enrichi (procédure `npm pack` → install dans un dossier jetable → run).
- [ ] **`npm publish`** proprement dit : choisir compte/organisation npm (le nom `token-flow-manager` doit être libre, sinon scoper `@robinlopez/…`), `npm login`, `npm publish --access public`. Puis valider `npm i -g token-flow-manager` → `tokenflow`.

> Vérifié en local : le bundle `node dist/cli.js [path]` démarre en autonome (sert l'API + la SPA embarquée), et `node dist/cli.js` (sans chemin) ouvre l'écran d'accueil où l'on choisit le projet.

---

## 11. Références

- [DTCG Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [DTCG GitHub](https://github.com/design-tokens/community-group)
- [Style Dictionary v5 (support DTCG)](https://styledictionary.com/info/dtcg/)
- [Tokens Studio — format DTCG](https://docs.tokens.studio/manage-settings/token-format)
- [Angular Signals & Signal Store](https://ngrx.io/guide/signals)
- [Spartan-ng (shadcn for Angular)](https://www.spartan.ng/)
- [Figma Variables UX reference](https://help.figma.com/hc/en-us/articles/15145852043927-Overview-of-variables-collections-and-modes)
