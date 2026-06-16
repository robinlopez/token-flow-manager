# Changelog

Journal des évolutions notables. Le dépôt est versionné en un **commit unique « Initial commit »** (historique volontairement écrasé à chaque cap) — **ce fichier reste la mémoire de reprise** avec [HANDOFF.md](HANDOFF.md) (état/archi/pièges) et [plan.md](plan.md) (plan produit).

Format inspiré de Keep a Changelog. Dates au format AAAA-MM-JJ.

## [0.1.0] — 2026-06-23

Première version préparée pour publication npm.

### Préparation de la release v0.1.0 (npm)

- **Package CLI autonome vérifié** : `npm pack` côté `packages/cli` ne ship que `dist/` — `dist/cli.js` (268 kB, packages workspace inlinés par tsup) + la SPA Angular embarquée (`dist/web/*`). 10 fichiers, 238 kB packés. `bin` expose `tokenflow` **et** `token-flow-manager`. Vérifié : `tokenflow --version` → `0.1.0`, `tokenflow validate examples/basic` → 12 tokens, 0 erreur.
- **Packages internes en `private: true`** : `@tokenflow/shared`, `@tokenflow/core`, `@tokenflow/server` (comme `@tokenflow/web`). Ils sont **bundlés** dans le CLI par tsup (`noExternal`), jamais publiés séparément → `private` empêche toute publication accidentelle.
- **Dépendance morte retirée** : `simple-git` était déclarée dans `cli` **et** `server` sans aucun import (l'intégration Git n'est pas codée — cf. plan.md Phase 5). Retirée des deux `package.json` + lockfile resynchronisé, pour ne pas embarquer une dépendance inutile dans le package publié. À ré-ajouter quand la Phase 5 démarre.
- **Hygiène repo / sécurité** : scan secrets → RAS (les seuls « token » du code sont le **token d'auth aléatoire** généré au runtime via `randomBytes`, jamais en dur). `.claude/launch.json` (config de debug locale : chemins `/tmp`, token de dev `tfmdev`) **dé-tracké** ; `.gitignore` ignore désormais tout `.claude/`. `plan.md`/`CHANGELOG.md`/`HANDOFF.md` **retirés du `.gitignore`** (ils étaient ignorés tout en étant suivis — incohérence levée, ce sont des docs versionnés).
- **Roadmap** : réintroduction de la **Phase 5 — Intégration Git** (lecture seule, non-intrusive) dans plan.md, alignée sur les specs §4.6/§6.2 ; statut npm de §10.2 mis à jour.

### 2026-06-23 — Phase 4 : Distribution = machine à 3 états (landing / overview / lien externe)

L'espace Distribution n'affiche plus toujours l'assistant : c'est un **configurateur à 3 états** routé depuis l'état serveur à l'ouverture.

- **`view: 'landing' | 'assistant' | 'overview' | 'link'`** dans `distribution.component.ts`, routé dans `load()` d'après `GET /api/distribution` : `savedMatrix`/`v5ScriptPath` → **overview v5** ; sinon `linked` → **overview externe** ; sinon → **landing**.
- **Landing** : 2 cartes — « Configurer la conversion » (recommandé → assistant) et « J'ai déjà ma config » (→ lien), cette dernière **pré-remplie** depuis `npmScripts` (commande suggérée) et `detectedConfigs` (scan `existsSync` des configs courantes : `config.json`, `sd.config.*`, `tokens.config.*`, …).
- **Overview** : v5 = résumé du pipeline (sources→variantes / cibles→dossiers + chemin du script) avec **Tester le build** (sandbox) / **Modifier** / **Ouvrir les fichiers** ; externe = `configPath` + `buildCommand` avec **Lancer le build** / **Modifier** / **Ouvrir** / **Délier**.
- **« J'ai déjà ma config »** : schéma `LinkedConfig {configPath, buildCommand}` + `linked`/`detectedConfigs` dans `DistributionStateSchema` ; sidecar **`.tokenflow/distribution-link.json`** (`readLinked`/`linkExisting`/`unlinkExisting`). **`POST /api/distribution/{link,unlink,run-command,open}`**.
- **`run-command`** = `ProjectManager.runProjectCommand` → `runExternalCommand` (`distribution-v5.ts`) : exécute la **vraie commande** du projet (`sh -c <cmd>`, cwd=root, timeout 120 s), mappée en `DistBuildReport` via `scanConsoleDiagnostics` (helper partagé avec le test-build). ⚠️ **Non sandboxé — écrit les vraies sorties** : l'UI l'affiche comme « Lancer le build » + bannière d'avertissement (≠ test-build v5 sandboxé).
- **Vérifié** : tests `distribution.test.ts` (13 — link/unlink + run-command ok/erreur-réf/exit-code) ; live en preview `tokenflow-play` — landing→lien→lier→overview externe→Lancer (✓ OK)→Délier→landing, et landing→assistant→Enregistrer→réouverture=overview v5. 0 erreur console.

#### Correctifs de suivi (retour utilisateur, 2026-06-23)

- **UI Distribution traduite en anglais** (était en français) — toutes les vues (landing/link/overview/assistant) + toasts.
- **Détection à la racine du package** : `ProjectManager.pkgRoot()` remonte jusqu'au plus proche `package.json`. Quand l'utilisateur ouvre le **sous-dossier de tokens** (ex. `src/design-tokens`, où vit leur `tokenflow.config.json`), la détection SD / `npmScripts` / `detectedConfigs` et le **cwd du run-command** visent désormais la **vraie racine** (où sont `node_modules`, `package.json`, `token-config.json`). Corrige le badge **« SD none »** persistant et les suggestions vides. Test `distribution.test.ts` (ouverture sous-dossier → SD v3 + scripts + config détectés).
- **`run-command` liste les fichiers produits** : `scanProducedFiles` repère dans le stdout/stderr les chemins de fichiers générés, **confirmés sur disque** (taille réelle via `statSync`) → l'overview externe n'affiche plus « 0 fichier » alors que le build a tourné (cas SD v3 du projet primeng-theme-starter).
- **Checkbox « Tokens Studio preset »** : libellé clarifié + icône **(i)** avec tooltip expliquant qu'elle ajoute `@tokens-studio/sd-transforms` (à n'activer que pour des tokens au format Tokens Studio).
- **Badge SD** : tooltip explicatif (v3 → orienter vers « I already have my config » car l'assistant v5 cible SD v5+).
- Tests `distribution.test.ts` (14).

#### Polish UI + nettoyage settings (retour utilisateur, 2026-06-23)

- **Bouton « Run build » dédramatisé** : icône **▶** (play) au lieu de **⚠**, bordure neutre — l'avertissement « écrit les vraies sorties » reste dans la bannière. Moins anxiogène.
- **Badge SD recoloré** : **vert** « ✓ Style Dictionary v3/v5 » dès que SD est **installé** (avant : jaune = perçu comme warning), **gris** « Style Dictionary not installed » sinon. Libellé complet (plus « SD none »).
- **Settings — option morte retirée** : `normalizeOnSave` (« Normalize on save ») n'avait **aucun consommateur** (promettait une conversion vers `$extends` non implémentée) → supprimée partout (schéma `config.ts`, `api.ts`, `config-loader.ts`, `project.ts`, models web, UI, CLI, tests). La section « Writing » devient **« File watching »** et « Write debounce » → **« Reload debounce »** (description corrigée : c'est le debounce de **rechargement après modif externe** via le watcher, pas un debounce d'écriture).
- **Projet de test factice** : `sandbox/blank-tokens-project/` (package vierge **sans** Style Dictionary + 2 fichiers de tokens DTCG `primitives`/`semantic` avec alias) pour tester une config manuelle. `sandbox/` ajouté au `.gitignore`.
- **Vérifié sur le vrai projet** primeng-theme-starter (ouverture du sous-dossier `src/design-tokens`) : `sdVersion={installed:3,mode:'v3'}`, `detectedConfigs=['token-config.json']`, `npmScripts=['generate:tokens','postinstall']` → badge vert + champs lien pré-remplis. Suite serveur : 68 verts (hors 4 `app.test.ts` pré-existants).

#### Fix fuite de brouillon entre projets (retour utilisateur, 2026-06-23)

- **Bug** : au changement de projet, l'assistant Distribution (étape Variantes) affichait les **fichiers du projet précédent**. Cause : le brouillon `localStorage` était indexé par `manifestPath`, qui vaut `''` pour tout projet **sans manifest** → **collision de clé** entre projets, le brouillon précédent ressortait.
- **Fix** : `DistributionState.projectId` (= racine du projet, exposé par le serveur) ; le brouillon est désormais indexé `tf.dist.matrix:<projectId>`. Plus aucune fuite inter-projets. Vérifié live (un brouillon semé sous l'ancienne clé vide est ignoré ; la persistance écrit bien sous la clé scopée) + test `distribution.test.ts` (`projectId === root`).

#### Save build : auto-ajout des dépendances + I/O au package root (retour utilisateur, 2026-06-23)

- **« Save build » ajoute les deps** : le script v5 généré fait `import 'style-dictionary'` (+ `@tokens-studio/sd-transforms` si le preset Tokens Studio est coché). `writeDistribution` ajoute désormais ces specs aux **`devDependencies`** du `package.json` (`style-dictionary@^5.0.0`, `@tokens-studio/sd-transforms@^1.0.0`) **si absentes de tout champ de dépendances** (idempotent ; n'écrase pas une SD v3 déjà présente). Il **n'exécute pas** `npm install` — `WriteDistributionResult.addedDependencies` remonte les specs ajoutés et l'UI affiche une bannière « Added to devDependencies … Run `npm install` before building ».
- **I/O distribution au package root** : `writeDistribution`, `scaffoldBuildScript`, `ensureNpmScript`, `ensureBuildDependencies`, les sidecars (`distribution.json`/`distribution-link.json`), la détection (`v5ScriptPath`/`buildScriptPath`) et le `test-build` passent par `pkgRoot()` (cohérent avec la détection SD/npm). Le script + le `npm run` atterrissent donc dans le **vrai** `package.json`, même si on a ouvert un sous-dossier.
- **Vérifié** : headless sur `sandbox/blank-tokens-project` (Save build → `devDependencies.style-dictionary: ^5.0.0` + script `tokens:build` + `addedDependencies:['style-dictionary@^5.0.0']`, 2ᵉ write idempotent → `[]`) ; live en preview (bannière deps + `npm install`). Tests `distribution.test.ts` (14, dont assertion deps + idempotence).

### 2026-06-22 — Phase 4 : « Enregistrer le build » (écriture réelle des fichiers + persistance serveur)

L'assistant écrit désormais de **vrais fichiers** dans le projet (fini la matrice en localStorage seule).

- **`POST /api/distribution/write`** → `ProjectManager.writeDistribution(matrix)` : écrit **`scripts/tokens.build.mjs`** (script v5 auto-suffisant, matrice embarquée — `generateV5Script`), ajoute le script npm **`tokens:build`** (idempotent), et **persiste la matrice** dans **`.tokenflow/distribution.json`** (atomique + backup). N'exécute PAS le build (ça reste `npm run` côté projet ; seul le test-build tourne, sandboxé).
- **`getDistribution`** expose `savedMatrix` (sidecar) + `v5ScriptPath` → l'UI **restaure depuis le serveur** (priorité : sidecar > brouillon localStorage > dérivé des collections).
- **UI** : bouton **« Enregistrer le build »** (étape Build & test) + bannière de confirmation (script écrit, matrice persistée, `npm run tokens:build`).
- **Vérifié** : headless — `writeDistribution` écrit les 3 artefacts et le **script écrit build réellement en standalone** (CSS + TS produits sur les tokens PrimeNG, 0 diagnostic) ; live — bouton → bannière + fichiers écrits dans le projet (script valide `node --check`, npm ajouté, sidecar) ; round-trip `savedMatrix` à la réouverture. Test `distribution.test.ts` (11).
- ✅ Reste « 3 états » bouclé le 2026-06-23 (voir entrée du jour).

### 2026-06-21 — Phase 4 : modèle de variantes générique + générateur réécrit + assistant 3 étapes

Refonte sur la base du retour utilisateur : **on ne devine plus la « nature » des modes** (présomptueux). Une collection a des **variantes nommées** (détectées : modes ou fichiers de thème) ; chaque cible applique une **stratégie de rendu générique par (collection × cible)** — `Sélecteurs` / `Media queries` / `Fichiers séparés` / `Un seul` — avec mapping `variante→valeur`, pré-rempli par heuristique de noms (éditable). Marche pour des modes arbitraires (`compact/comfortable`…).

- **Modèle** (`shared/distribution.ts`) : `MatrixSource.variants: {name, file?}[]` (file = thème-fichier, sinon segment de mode) ; `MatrixTarget.rendering: Record<sourceId, {strategy, map}>`. Remplace `theming` (nature devinée) **et** `variant` globale de cible.
- **Générateur** (`distribution-v5.ts`, réécrit) : émet **par (cible × collection)** via `getPlatformTokens` (résolution + transforms), puis **émission manuelle** CSS/SCSS/TS/JSON → un seul fichier peut contenir plusieurs blocs **sélecteur** (`:root` / `[data-theme]`) ou **@media**, ou un objet imbriqué (TS), ou des fichiers par variante. Wrap de namespace auto pour résoudre les refs ; nom kebab (CSS) / camel (JS) sans le segment de mode.
- **Assistant UI 3 étapes** (`features/distribution`) : **Variantes** (chips de noms détectés, éditables, faux-positifs retirables) → **Sorties** (cibles + stratégie par collection auto-dérivée + mapping) → **Build & test**.
- **Vérifié en réel** sur les tokens PrimeNG : `semantics.css` (sélecteurs `:root`/`[data-theme=dark]`), `responsive.css` (`@media (min-width…)`), `metrics.css` (à plat), `primitives.themeOne/Two/Three.ts` (objet par thème), `semantics.ts` (objet imbriqué light/dark, plus de double-nesting) — **0 diagnostic** ; live : assistant complet + test build ✓ 149 ms, 0 erreur console. Tests `distribution.test.ts` (10).

### 2026-06-20 (suite) — Phase 4 redesign : assistant UI 4 étapes + rendu du Test build

L'UI Distribution est repensée en **assistant guidé** (remplace les onglets de champs bruts jugés peu parlants) : `features/distribution/distribution.component.ts` réécrit.

- **Stepper 4 étapes** : ① **Sources** (collections détectées, `wrap under` par source, source root) · ② **Theming** (par source : `single / themes / modes`, pré-rempli depuis la détection, édition des thèmes) · ③ **Cibles** (presets CSS variables/SCSS/SCSS map/TS/JS/JSON ; par cible : dossier de destination **distinct**, format, **stratégie de variante** sélecteur-par-mode / fichier-par-thème / merge, sélecteurs par mode) · ④ **Build & test**.
- **Bouton « Run test build »** → `POST /api/distribution/test-build` → rapport : badge **✓/✗ + durée**, panneau **diagnostics** (chips erreur ●/warning ▲, **ANSI strippé**, « token collisions » = warning non-bloquant), panneau **fichiers produits** (cible + chemin + taille). Vérifié live sur le projet de jeu : ✓ Build OK 183ms, 6 fichiers, collision en warning.
- **Matrice** dérivée des collections (`deriveMatrix`) + **persistée en localStorage** ; toggle **Tokens Studio**. Langage clair, badge de version SD du projet.
- Générateur affiné : variant `merged` n'éclate plus par mode ; `parseReport` strippe l'ANSI et classe collisions/refs-filtrées en warning (seules les réfs non résolues sont des erreurs).
- Reste : preview Monaco, persistance **serveur** de la matrice, scaffold du script **v5**, diagnostics cliquables.

### 2026-06-20 — Phase 4 redesign : cible Style Dictionary v5 + générateur + Test build (backend)

Repositionnement de la Phase 4 (cf. `plan.md` réécrit) : on **cible SD v5** (DTCG-native), une **UX guidée** (assistant Sources → Theming → Cibles → Build), et un **bouton Test build** avec rapport. Cette passe livre le **socle backend** (le plus risqué), validé sur de vrais tokens ; l'assistant UI suit.

- **Générateur SD v5** (`packages/server/src/distribution-v5.ts`) : `generateV5Script(matrix)` émet un **script ESM auto-suffisant** que le projet possède — DTCG-native (plus de `$value→value`), **wrap des sources sous leur namespace** (`primitives`/`metrics`) pour que les `{ref}` résolvent, **name-transform sans segment de mode** (kebab pour CSS, **camelCase pour JS** = identifiant valide), **modes → sélecteur CSS**, **multi-cibles à dossiers distincts**, `@tokens-studio/sd-transforms` optionnel.
- **Détection de version** : `detectSdVersion(root)` (v3 / v5 / none) — on garde le pipeline v3 des projets existants, v5 pour le neuf.
- **Test build** : `runTestBuild(root, matrix)` exécute le script généré dans un **sandbox jetable** (node_modules symlinké vers notre SD v5, sorties écrites dans le sandbox → **le projet n'est jamais touché**), lit les **vrais** tokens (sourceRoot absolu), renvoie un `DistBuildReport` `{ ok, outputs[{target,file,bytes}], diagnostics[{level,message,token?,theme?}], durationMs }`. SD lancé `verbosity:'verbose'` + `brokenReferences:'console'` (non-fatal) → références non résolues / collisions / warnings **captés** (stdout+stderr), dédupliqués, bruit filtré ; une réf cassée ⇒ `ok:false`. Endpoint `POST /api/distribution/test-build` ; `sdVersion` ajouté à `GET /api/distribution`.
- **Vérifié en réel** sur les tokens PrimeNG : 3 thèmes × light/dark en **CSS (sélecteurs `:root`/`[data-theme=dark]`)** + **TS** dans des dossiers séparés, **0 diagnostic** ; cas réf cassée → `ok:false` + diagnostic « {x} tries to reference {y}, which is not defined ». Schémas Zod (`DistMatrix`/`DistBuildReport`/`SdVersionInfo`) dans `shared/distribution.ts`. Tests `distribution.test.ts` (10).
- ⬜ Reste : persistance/édition de la matrice, **assistant UI 4 étapes** (avec rendu du rapport + preview Monaco), scaffold du script **v5**.

### 2026-06-19 (suite 6) — Phase 4 : Compagnon de configuration Distribution (manifest `token-config.json`) — slice 4.1 → 4.3

Nouvel espace **Distribution** : un éditeur visuel du **manifest `token-config.json`** (icône cube dans le header). Le projet reste autonome — il build via un **script de build qu'il possède** (`scripts/build-tokens-sd.js`, Style Dictionary), piloté entièrement par le manifest.

> **Pivot vs première intention.** Un éditeur de config Style Dictionary « vanilla » (source + platforms) avait d'abord été codé, mais il **ne couvre pas** les pipelines réels (multi-thèmes, modes `modeLight/modeDark`, wrap des primitives, rewrite `{primitives.}`→`{primitive.}`, résolution cross-fichier via `include`, SCSS map + mixin, shadows résolues) — d'où des erreurs « reference not defined » sur une vraie base. La feature a été **pivotée** vers l'édition du manifest `token-config.json` (que TFM lit déjà pour les collections), avec **scaffolding du script de build**.

- **4.1 Ciblage & parsing** : détection de `token-config.json` (ou `tokens.config.json`) à la racine ; parser bidirectionnel `packages/server/src/distribution.ts`. **Round-trip JSON** : le modèle édité est **mergé sur l'objet disque** → toutes les clés non modélisées (chemins `outputPath`/`scssOutputPath`, `perTokenFile`, clés custom de thème/groupe, etc.) **survivent**.
- **4.2 Wizard zéro-config** : si aucun manifest, **`Create token-config.json`** génère un manifest de départ (thèmes/groupes dérivés des collections) **et** (option cochée) scaffolde un **`scripts/build-tokens-sd.js`** (script SD v3 éprouvé, généralisé : résolution de la racine via `token-config.json`, `SOURCE_ROOT`/`PRESET_OUTPUT` paramétrables) + ajoute le script npm **`generate:tokens`**. Écriture atomique + backups (`.tokenflow/backups/`). Le script embarqué vit en base64 dans `build-tokens-template.ts` (source lisible : `packages/server/scripts-src/build-tokens-sd.js`).
- **4.3 Éditeur visuel** : onglets **Output** (useCssVariables, exportPrefix, buildPath, sourceRoot, tempDirectory) · **Theme mode** (mode `light/dark/merged/both` + defaultTheme + light/darkSelector) · **Themes** (name/primitiveFile/objectName, add/remove) · **Tokens** (groupe par concern : enabled + source + toggles TS/SCSS, add/remove). Bouton **Save manifest** (dirty), **Scaffold build script** quand absent, liste des scripts npm liés.
- **Endpoints** : `GET /api/distribution`, `PUT /api/distribution` (manifest), `POST /api/distribution/{init,scaffold-script}`. Schémas Zod dans `shared/distribution.ts`.
- **Vérifié** : 6 tests (`distribution.test.ts` — parse, round-trip clés inconnues, manifest par défaut, init+scaffold, édition round-trip, template valide) ; UI live sur le **vrai `token-config.json`** d'un projet PrimeNG (lecture des 3 thèmes + 7 groupes, édition `exportPrefix` → save → **toutes les clés préservées** sur disque + backup, scaffold du script + `generate:tokens`, 0 erreur console) ; et le **script scaffoldé exécuté en réel** (SD v3) sur les tokens du projet → génère SCSS (map multi-thèmes + mixin) + TS (primitives/semantics/shadows…) **sans erreur de référence**.
- `style-dictionary` v5 reste dépendance (server + cli) pour le futur dry-run (4.4) ; le script scaffoldé cible l'API **SD v3** (celle des projets existants).

### 2026-06-19 (suite 5) — Éditeur de gradient (array de stops, conforme DTCG)

Le type composite **`gradient`** n'ouvrait aucun éditeur : son `$value` est un **array de stops** `[{color, position}]` ([spec DTCG](https://www.designtokens.org/tr/drafts/format/#gradient)), or `isCompositeValue` excluait les arrays (`!Array.isArray`) et `commitComposite` réassemblait un **objet** (cassait l'array).

- **`isCompositeValue`** accepte désormais l'array pour `gradient` (objet pour les autres composites).
- **Éditeur de stops dédié** (popover) : barre de **preview** `linear-gradient`, une ligne par stop = **pastille couleur** (→ color picker / alias) + champ couleur + **position** `0–1` + **supprimer** ; bouton **« Add stop »** (min. 2 stops). `commitComposite` réassemble un **array `[{color, position:number}]`** (positions coercées en nombre).
- **Aperçu cellule** : `formatValue` rend un gradient en `#000 0, #fff 1` au lieu de `[object Object]`.
- **Valeurs par défaut** (`defaultValueForType('gradient')`) = 2 stops noir→blanc, déjà conformes.
- Vérifié live : création d'un gradient → l'éditeur s'ouvre (preview + stops + add/remove) ; Apply persiste `[{color,position}]` (numérique) sur **tous les modes** (collection mode-repliée) ; 0 erreur console.

### 2026-06-19 (suite 4) — Renommer un groupe depuis le divider + sortir les variables de la racine

Suite à la création de variables : une variable créée à la **racine** d'une collection apparaissait sous un divider `(root)` — non listé en sidebar et non renommable.

- **Renommage de groupe depuis le divider du tableau** : double-clic sur l'en-tête de section (ou bouton crayon au survol) → input inline. Pour un **vrai groupe** → `renameGroup` (références propagées, mode-aware). Le label `(root)` devient **« Ungrouped »** (italique).
- **Promotion des variables racine en groupe** : renommer le divider « Ungrouped » **déplace les variables racine dans un nouveau groupe** nommé (`moveTokensToParent`) — qui devient un vrai groupe **visible dans la sidebar** (et la vue se filtre dessus). Résout « le groupe root n'apparaît pas dans la sidebar et n'est pas renommable ».
- Vérifié live : `Ungrouped → spacing` (le token racine passe dans `spacing`, apparaît en sidebar) ; `screen → viewport` (vrai groupe renommé, propagé) ; 0 erreur console.

### 2026-06-19 (suite 3) — Polish éditeurs composites

Trois retours UX sur les valeurs composites (typography / shadow / border / transition / gradient) :

- **Icône `shadow`** : `☁` → **`❏`** (carré avec ombre portée) — bien plus lisible comme « shadow ».
- **🐛 Affichage d'un alias en sous-propriété** : dans la cellule, un sous-champ composite aliasé montrait sa **valeur résolue** au lieu de l'alias (le JSON sur disque était pourtant correct). `tf-value-cell` rend désormais la forme **brute** pour les valeurs objet (les `{group.token}` restent visibles). Vérifié : `text.heading.fontSize = {screen.width}` → la cellule affiche `{screen.width}`, plus `1440px`.
- **UX d'ouverture de l'éditeur composite** : le double-clic n'était pas découvrable. Ajout d'une **icône d'édition** dédiée dans la cellule (signale une valeur structurée) **et** le **simple clic** ouvre maintenant l'éditeur de champs. Le bouton « lien » générique n'apparaît plus sur les cellules composites (le lien d'alias se fait par sous-champ dans l'éditeur). Vérifié live, 0 erreur console.

### 2026-06-19 (suite 2) — Thèmes d'accent + sélecteur dans Settings (défaut = marque Token Flow #181919)

- **Couleur primaire de marque par défaut** : l'accent `forge` passe de l'orange `#EA580C` au **`#181919`** (marque Token Flow, quasi-noir neutre). L'orange reste proposé en thème alternatif (« Forge »).
- **Palette `forge` thémable au runtime** : dans `tailwind.config.js`, `forge-*` résout désormais vers des variables CSS en triplets de canaux (`rgb(var(--forge-N) / <alpha-value>)`) → un changement de thème **re-peint toute l'UI** (boutons, anneaux de sélection, surbrillances, chips), modificateurs d'opacité (`forge-300/60`) inclus. Valeurs définies dans `styles.css` (`:root`/`[data-theme="tokenflow"]` = marque ; `[data-theme="forge"]` = orange).
- **Onglet « Appearance » dans Settings** : sélecteur de thème (cartes avec pastille + hex + libellé, état « Active »). Choix **persisté en localStorage** (`UiService.theme`, clé `tf.theme`, défaut `tokenflow`) et appliqué via `<html data-theme>` (effet dans `UiService`). Applique instantanément, mémorisé par navigateur (pas dans `tokenflow.config.json`).
- Ajouter un thème = une entrée dans `THEMES` (`core/ui.service.ts`) + un bloc `[data-theme="…"]` de variables dans `styles.css`. Vérifié live : défaut `#181919`, bascule vers Forge → orange sur tout le dashboard, retour au défaut, 0 erreur console.

### 2026-06-19 (suite) — Fix delete mode-aware + menu d'actions `⋯` dans l'inspector

- **🐛 Fix `deleteToken` mode-aware** : la suppression utilisait `token.source.file` (1 seul fichier) + le chemin **logique** → **échec silencieux** sur les collections **mode-repliées** (le nœud est au chemin physique avec segment de mode) et suppression partielle sur les collections **file** (un fichier par thème, seul le 1er nettoyé). C'était la cause du « delete qui ne fait rien ». Désormais : itère `collectionFiles` + supprime tous les `physicalPaths` (comme `deleteGroup`), écriture transactionnelle. Test `project.test.ts` (suppression sur collection mode-repliée → les 2 nœuds disparaissent).
- **Store `deleteToken`** : ne **gobe plus** l'échec — `try/catch` + **toast** sur erreur (HttpClient rejette les 422), retourne un booléen, et retire l'id de la multi-sélection.
- **Menu d'actions `⋯` dans l'inspector** : un bouton `⋯` dans l'en-tête du panneau de détail ouvre le **même menu** que le clic droit d'une ligne (Rename / Duplicate / Copy / Cut / Paste here / **Delete**), via le `ContextMenuService` partagé. Delete depuis l'inspector ferme le panneau. Vérifié live (preview) : delete OK depuis l'inspector **et** depuis le clic droit du tableau sur collection mode-repliée, 0 erreur console.

### 2026-06-19 — Création de variables (toolbar + divider de groupe), mode-aware

Nouvelle capacité **Créer une variable** dans une collection (le `POST /api/tokens` existait côté serveur mais n'était pas branché en UI, et était cassé sur les collections mode-repliées).

- **Deux points d'entrée UI** :
  - **Toolbar** (à côté de la recherche) : bouton **`+ Create variable`** ouvrant une **dropdown de types** (color, dimension, number, duration, fontFamily, fontWeight, cubicBezier, strokeStyle, typography, shadow, border, transition, gradient — chacun avec son glyphe). Le choix crée la variable dans le **groupe actif** (filtre sidebar) sinon à la **racine** de la collection.
  - **Divider de groupe** dans le tableau : un **`+`** discret (visible au survol de l'en-tête) ajoute une variable **dans ce groupe**, son **type étant inféré** des tokens du groupe (un groupe de couleurs → une couleur ; fallback `color`).
- **Valeurs par défaut par type** (`defaultValueForType`, `core/format.ts`) : `#000000`, `0px`, `0`, `0ms`, `sans-serif`, `400`, `[0.25,0.1,0.25,1]`, `solid`, et objets composites cohérents (typography/shadow/border/transition/gradient).
- **Flux Figma-like** : la nouvelle ligne est sélectionnée et **passe directement en renommage inline** (`pendingRenameTokenId` dans le `ProjectStore`, repris par la table).
- **Fix serveur (createToken mode-aware)** : l'ancienne heuristique écrivait toujours un `$value` **inline** keyé par mode → cassé sur les collections **dimension** (segment de mode dans le chemin) et **file** (un fichier par thème). `createToken` respecte désormais la stratégie de stockage (`modeInfo`) :
  - `dimension` → un nœud scalaire par mode au **chemin physique** (segment de mode inséré, via `physicalPaths`) ;
  - `file` → un nœud scalaire par mode, **dans le fichier de ce mode** ;
  - `inline` → un seul nœud avec `$value: { mode: valeur }` ;
  - `none` → un `$value` scalaire.
  - Écriture transactionnelle (`commitStaged`, 1 item d'historique).
- **Tests** : nouveau cas `project.test.ts` (création multi-mode sur collection mode-repliée, vérif disque + résolu par mode). Vérifié **live** (preview) sur `examples/multimode` : création via toolbar (root) et via `+` de groupe, valeurs `0px` dans chaque colonne de mode, renommage inline, 0 erreur console.

### 2026-06-16 (suite 2) — éditeurs composites typés + alias sur couleurs/métriques + overrides incomplets

Avancement **Phase 3** (Multi-mode, multi-brand, composites).

- **Éditeurs composites typés** : l'éditeur *expand-in-place* (typography / shadow / border / transition / gradient) connaît désormais le **type DTCG de chaque sous-propriété** (`compositeFieldType` dans `core/format.ts`).
  - Sous-valeur **couleur** (ex. `shadow.color`) → **pastille** cliquable (color picker Custom) **+** bouton **lien** pour poser un alias.
  - Sous-valeur **métrique** (dimension / number / duration — ex. `typography.fontSize`, `shadow.offsetX`) → bouton **lien** → ouvre le picker **Libraries filtré par type** pour choisir un alias `{path}`.
  - L'alias est écrit dans la sous-propriété du `$value` (commit alias-aware) et **résolu récursivement** par le resolver. Vérifié live : `shadow.card.offsetX = {size.sm}` → résout `1rem` ; le picker d'une sous-valeur couleur ne propose que des tokens couleur.
  - Mécanique : le `CellPickerService` accepte un callback `onPick(value)` — en mode sous-champ il renvoie la valeur (couleur CSS ou `{alias}`) au lieu d'écrire la cellule.
  - Types **scalaires** (`duration`, `cubicBezier`, `strokeStyle`) : restent édités/aliasables directement en cellule (lien d'alias déjà présent).
- **Détection d'overrides incomplets** : un token multi-mode qui ne définit qu'une partie des modes lève un **warning** `incomplete-mode-override` (le mode manquant hérite silencieusement du défaut). Émis dans `resolver.ts` (collections ≥2 modes). Tests `resolver.test.ts`.
- **Restant Phase 3** (passes dédiées) : `$extends`, color picker **OKLCH** + gamut sRGB/P3 (besoin `culori`), virtualisation CDK, édition par-stop des gradients en tableau.

### 2026-06-16 (suite) — modes : suppression + duplication + `+` agrandi

- **Supprimer un mode** : **clic** sur un en-tête de colonne le **sélectionne** (surbrillance), puis **Suppr/Delete** (ou Backspace) le supprime. Le **dernier** mode ne peut pas être supprimé (toast).
- **Clic droit** sur un en-tête de colonne → menu **Rename / Duplicate / Delete**.
- **Dupliquer un mode** : crée une copie (nom libre `<mode>2`) seedée depuis le mode.
- **Bouton `+` agrandi** : remplacé par une **icône SVG** (20×20) centrée, hover forge.
- Mécanique par stratégie : **fichier** delete=désenregistre le mode (`.json` laissé sur disque), dup=copie de fichier ; **dimension** `removeModeAtDimension`, dup=`duplicateModeAtDimension` ; **inline** `removeInlineMode`. Endpoints `POST /api/modes/{delete,duplicate}`. Tests `project.test.ts` (delete inline/dimension/file + dernier-mode refusé + dup fichier). Vérifié live (preview : +/clic-select/Delete/clic-droit/dup, 0 erreur console).

### 2026-06-16 — gestion des modes : ajouter / renommer un mode (Phase 3, multi-stratégie)

Système unifié et robuste pour **ajouter** et **renommer** un mode, qui détecte automatiquement *comment* une collection stocke ses modes et agit en conséquence — couvre tous les cas rencontrés (et au-delà).

- **3 stratégies de stockage** (détection via `ProjectManager.modeInfo(collection)`) :
  - **fichier** (1 fichier par thème, ex. primitives `themeOne/Two/Three.json`) : ajout = **copie** du fichier d'un mode source (`<name>.json` à côté des autres, enregistré dans `fileModes`+`files`) ; renommage = **relibellé en config seulement** (le `.json` est conservé — la config de build référence les noms de fichiers).
  - **dimension de chemin** (segment `modeLight/modeDark`, `desktop/tablet/mobile`…) : ajout = **clone du sous-arbre** du segment dans chaque fichier ; renommage = renommage du segment **en préservant l'ordre des clés**.
  - **inline** (`$value: { light, dark }`) : ajout/renommage de la **clé `$value`** sur chaque token.
  - **mono-mode** : le premier ajout **convertit en inline** (les valeurs sont enrobées `{ default, <new> }`).
- **Seed par copie** (façon Figma) : un mode ajouté part d'une **copie** d'un mode source choisi.
- **UI** : le bouton **`+`** de l'en-tête du tableau ouvre un **popover** (nom + « copier les valeurs depuis » un mode) ; **double-clic** sur un en-tête de colonne = **renommage inline** (Enter/Esc). Toast d'erreur sur échec (ex. mode en doublon).
- **Backend** : `POST /api/modes/add` + `POST /api/modes/rename` (`addMode`/`renameMode`), helpers core `duplicateModeAtDimension`/`renameModeAtDimension`/`duplicateInlineMode`/`renameInlineMode`/`wrapValuesAsInline` (`document.ts`). Écritures **atomiques** (rollback). Ce sont des ops **structurelles** (elles réécrivent aussi `tokenflow.config.json`) → comme les réglages, elles **réinitialisent l'undo byte-exact** plutôt que de risquer une désync.
- **🐛 Fix fiabilité (fichier-modes)** : éditer une valeur **par mode** sur une collection fichier-modes écrit désormais dans **le fichier du bon mode** (`fileEntryForMode`) — auparavant tout allait dans le 1er fichier.
- **Tests** : `project.test.ts` — add+rename pour les 4 cas (dimension, inline, fichier + routage de valeur, mono→inline) + rejet de doublon. Vérifié **live** (HTTP sur une copie des primitives PrimeNG + UI en preview : `+` → popover, ajout d'un mode = nouvelle colonne, renommage, toast sur doublon, 0 erreur console).

> ⚠️ Pour voir les primitives PrimeNG **en modes**, la collection doit être en **fichier-modes** (`fileModes`) — pas en 3 collections séparées comme dans leur `tokenflow.config.json` verrouillé actuel. La feature marche d'office sur `semantics` (dimension modeLight/modeDark) et `responsive` (dimension desktop/tablet/mobile).

### 2026-06-16 — déplacement multi-sélection = un seul item d'historique (Phase 3.5.4 / 3.6.2)

Dernier point ouvert de **3.5.4** : un drag (ou couper-coller) de plusieurs variables produisait jusqu'ici **N** items d'undo (un rename serveur par token). Désormais c'est **un seul** item.

- **Nouvel endpoint `POST /api/tokens/move`** (`moveTokensBatch` dans `server/project.ts`) : applique N renames de tokens en **une seule transaction atomique** (tout ou rien) via `applyRenamesAtomic` → **une seule Command** d'historique (label « Move N variables », ou « Move a → b » pour un seul). Garde-fous en amont : même collection pour tous, rejet des collisions avec des tokens hors lot et des cibles dupliquées dans le lot (rien n'est écrit en cas d'échec).
- **Schéma** `MoveTokensRequestSchema` (`shared/api.ts`).
- **Front** : `ApiService.moveTokens(moves)` + `ProjectStore.moveTokens()` appelle l'endpoint batch au lieu de boucler sur N renames. Tous les chemins (drag table→groupe, drag sidebar, couper-coller de variables) passent par `moveTokens`/`moveTokensToParent` → bénéficient du 1-item gratuitement.
- **Tests** : `project.test.ts` (« batch move ») — 2 tokens déplacés = 1 item, un seul undo rétablit le lot **byte-exact** ; rejet atomique sur collision (aucun item). Vérifié aussi en réel (CLI sur `examples/multimode`, HTTP) : `Move 2 variables`, undo unique restaure les chemins.

### 2026-06-15 — chips d'alias façon Figma (pastille couleur, valeur résolue ciblée)

- **Pastille de couleur dans le chip d'alias** (`tf-value-cell`) : un alias de type couleur affiche désormais la **couleur résolue en pastille** en tête du tag (au lieu du glyphe ◐ générique), comme Figma.
- **Pastille aussi dans la liste du picker (Libraries)** : `swatchOf` utilisait `tok.type` → un token candidat lui-même aliasé (type `unknown`) n'avait pas de pastille. Corrigé via `effectiveType(tok.type, résolu)` → tous les tokens couleur (même aliasés) montrent leur pastille. Style harmonisé `rounded-[4px]`.
- **Valeur résolue ciblée** : on n'affiche plus le **code hexa** à côté d'un chip d'alias **couleur** (la pastille suffit) ; la valeur résolue n'est montrée à côté du chip que pour les types **numériques** (number/dimension/duration). Basé sur `effectiveType` (gère les alias `unknown`).

### 2026-06-14 (suite 4) — picker couleur/alias façon Figma (Custom + Libraries)

Remplacement du picker couleur par un vrai picker ancré à la cellule, façon Figma. Vérifié sur `examples/multimode` (et non sur le projet réel de l'utilisateur, pour ne pas polluer ses fichiers). typecheck 5/5, core 43 + server 40, 0 erreur console.

- **Nouveau composant `tf-cell-picker`** (`ui/cell-picker.component.ts`) + service `CellPickerService` + helpers couleur `core/color.ts` (hex/rgb/hsv, normalisation via canvas) :
  - Onglet **Custom** (couleurs) : carré saturation/valeur + curseur de teinte + curseur d'alpha (damier), champs **HEX/RGB** + **alpha %**, **pipette** (EyeDropper API si dispo). Drag = preview optimiste (`store.previewValue`), persistance au relâchement / à la saisie.
  - Onglet **Libraries** : liste des tokens du design system **filtrée par type** (un cell couleur ne liste que des tokens couleur, etc.), groupée par collection / groupe, recherche ; clic → pose l'alias `{path}`.
  - **Ancré à la cellule** (rect de la cellule, clampé au viewport ; bascule au-dessus si pas de place en dessous).
- **Clic sur un tag d'alias → ouvre l'onglet Libraries** (dropdown de tokens type-aware) ; un swatch couleur littéral → onglet Custom ; l'icône lien → Libraries. (L'ancien nuancier OS natif est retiré.)
- **🐛 Alignement vertical des valeurs couleur** : `tf-value-cell` host en `flex items-center` → swatch + valeur centrés de façon constante.
- **Alias incomplet** : un `{` (ou `{partiel` non fermé) laissé dans l'éditeur inline n'est plus écrit (revert), quelle que soit l'origine de l'édition.

#### 🐛 Filtrage par type robuste (picker + autocomplete)
- Une cellule **numérique aliasée** (donc `$type` inférable = `unknown`) proposait quand même des **alias couleur**. Cause : `typeCompatible(unknown, …)` laisse tout passer. Fix : `effectiveType()` (`web/core/format.ts`) infère le type d'une cellule `unknown` **depuis sa valeur résolue**, et les types numériques sont regroupés en **famille** (`number`/`dimension`/`duration`). Le picker « Libraries » ET l'autocomplete inline filtrent désormais sur le type effectif des **deux** côtés (cellule + candidat). Vérifié : cellule dimension → uniquement des tokens numériques (0 couleur), cellule couleur → uniquement des couleurs.
- **Plan** : ajout de la **Phase 3.7 — Robustesse du typage** (type effectif côté serveur en suivant la chaîne d'alias, inférence par cohérence de groupe, déclaration/forçage du `$type` depuis l'inspector, diagnostics d'incompatibilité d'alias). Le fix UI ci-dessus en est le palliatif.

### 2026-06-14 (suite 3) — polish édition : picker couleur, alias, anneaux, champ d'édition

UX de l'édition affinée (signalée par l'utilisateur), vérifiée live (style calculé + comportement), 0 erreur console.

- **Picker couleur en 1 clic** : cliquer le swatch d'une cellule couleur ouvre **directement le nuancier natif de l'OS** (input `type=color` caché `.click()` seedé à la valeur courante), au lieu du popover en 2 étapes. Preview live pendant le drag (`store.previewValue`, optimiste), commit au `change`. Les valeurs non-hex (oklch, nommées) restent éditables au double-clic. Ancien popover custom retiré.
- **🐛 Anneau « bleu » → fin liseré orange** : la palette `forge` n'avait pas de shade **400** (ni 300) → `ring-forge-400` était invalide et Tailwind retombait sur sa **couleur d'anneau bleue par défaut**, en `ring-2` (épais). Ajout de `forge.300/400` ; anneaux (cellule active, édition, focus de ligne) passés en **`ring-1 ring-inset ring-forge-400`** — fins, subtils, à la marque.
- **Alias préservé à l'annulation** : cliquer un chip d'alias pré-remplit l'éditeur avec **l'alias courant** (au lieu de `{`) ; si l'édition n'aboutit pas à un alias complet `{…}`, elle est **annulée** (l'alias d'avant est conservé) au lieu d'écrire `{`. Flag `aliasMode` + garde dans `commitEdit`.
- **Champ d'édition façon Figma** : l'input inline de valeur est désormais **transparent, sans bordure ni padding** (hérite de la cellule) → le layout ne bouge plus et on n'a plus l'aspect « champ de formulaire ». La cellule porte juste le fin anneau.

### 2026-06-14 (suite 2) — copier/coller de variables, sélection visible, raccourcis ⌘R/⌘S

Demandes utilisateur sur données réelles primeng. **43 tests core + 40 serveur**, typecheck 5/5, 0 erreur console, fichiers source utilisateur intacts.

- **Copier/coller une variable entière** (et plus seulement la valeur d'une cellule). Backend `ProjectManager.copyTokenTo(id, targetParentPath)` + `POST /api/tokens/:id/copy-to` : copie le token sous un parent choisi, leaf dédoublonné, **par mode/par fichier** (file-modes), un seul item d'historique. UI : clipboard de variables dans `ProjectStore` (`copiedTokenRefs`), `⌘C` copie la/les variable(s) sélectionnée(s) (hors cellule focus), `⌘V` colle dans la cible résolue (**groupe sidebar sélectionné → filtre actif → parent de la variable focus**) ; menu contextuel **Copy variable / Paste here** (tableau) et **Paste variable here** (groupe sidebar). Une cellule focus garde son `⌘C/⌘V` de valeur (stopPropagation).
- **🐛 Fix file-modes (impact large)** : `collectionFiles()` ne renvoyait que **le premier fichier** d'une collection à modes-par-fichier (car les tokens fusionnés rapportent une seule `source.file`) → copy/duplicate/delete-group ne touchaient qu'un thème (valeurs partielles/incohérentes). Corrigé : dérive les fichiers depuis l'ensemble chargé (`this.files` filtré par collection). Vérifié : un paste sur primitives copie bien les 3 thèmes.
- **Sélection plus visible** : ligne (tableau) et groupe (sidebar) sélectionnés passent en **`forge-100`** (fond ambré discret mais net), en plus de la barre d'accent — lisible en multi-sélection. Le groupe « actif » (filtre) reste en `forge-50`. **🐛 Fix CSS** : un `bg-white`/`bg-ink-50` **statique** sur ces éléments écrasait la classe conditionnelle `bg-forge-*` (même spécificité → l'ordre du CSS gagne) → aucune coloration ne s'affichait. Désormais le fond de base est **conditionnel** (`[class.bg-white]="!isSelected"`), mutuellement exclusif avec la couleur de sélection. Vérifié par style calculé : ligne sélectionnée = `rgb(255,237,213)`.
- **Raccourcis** : recherche de tokens **`⌘K` → `⌘S`** (label header mis à jour) ; **refresh sur `⌘R`** (`Ctrl+R`), avec `preventDefault` (n'effectue plus le reload navigateur). `⌘S`/`⌘R` sont globaux ; `⌘Z`/`⌘C`/`⌘V` restent ignorés en champ texte.

### 2026-06-14 (suite) — 3.5.2 (nav clavier + copier/coller), 3.5.3 (batch) + 2 bugs réels

Vérifié de bout en bout sur les données réelles d'un projet de test. **43 tests core + 38 serveur**, typecheck 5/5, 0 erreur console.

#### Bugs corrigés (signalés sur données réelles)
- **Type/unité des valeurs numériques.** Une chaîne purement numérique (`"0"`, `"16"`) était inférée `number` → un groupe comme `breakpoints { phone:"0", tablet:"600px" }` devenait hétérogène, `"0"` levait une erreur de validation, et taper `0px` était rejeté (le `px` « disparaissait »). Désormais : **chaîne numérique → `dimension`** (un vrai `number` reste un nombre JSON), `validateValue('number')` accepte aussi les chaînes numériques, et `DIM_STRING` accepte n'importe quelle unité CSS (`ch`, `fr`, …). Résultat : breakpoints uniformément `dimension`, `0` valide, `0px` éditable.
- **Reorder silencieux sur clés numériques.** Déplacer `500` en tête d'un groupe `{50,100,…,900}` ne marchait pas (JSON sérialise les clés entières en ordre croissant) **mais renvoyait `ok:true`** → l'UI « revenait à sa place » sans explication. `reorderTokens` détecte maintenant le no-op réel (contenu inchangé) et renvoie une **erreur claire** (« numeric keys keep JSON's ascending order ») ; l'UI affiche un toast. Diagnostic confirmé live : le reorder **non-numérique** (groupes) fonctionne parfaitement en modes-par-fichier — le problème était bien les clés numériques, pas le multi-fichier.

#### Phase 3.5.2 — navigation clavier + copier/coller (cellules)
- Cellule **active** focusable (`tabindex=-1`, ring forge) ; `↑/↓/←/→` déplacent entre cellules (`data-cell="row-mode"`), `Enter`/`F2` éditent.
- `Cmd/Ctrl+C` copie la valeur brute (clipboard interne), `Cmd/Ctrl+V` colle ; **coller sur une multi-sélection** applique à toutes les lignes via le batch (un seul item d'historique).
- Reset de l'état de cellule (active/éditeurs) au changement de collection (les index de ligne sont relatifs à la collection).

#### Phase 3.5.3 — écritures groupées (transactionnel)
- `PATCH /api/tokens/batch` + `ProjectManager.updateValuesBatch` : N éditions de valeur, **un flush par fichier**, validation atomique (tout ou rien), **un seul item d'historique** (`Set N values`). Gère la traduction logique→physique (collections mode-repliées). Tests : batch = 1 item + undo restaure tout ; batch invalide rejeté sans écriture.
- Reste : `deprecated` en masse (mutation `metadata` à ajouter).

### 2026-06-14 — Phase 3.6 (Undo/Redo byte-exact) + Phase 3.5.5 (édition rapide par type)

Deux phases livrées et vérifiées de bout en bout (live + tests). **37 tests core + 35 tests serveur** (4 nouveaux pour l'undo/redo), typecheck strict clean (5 packages), `web` build OK, 0 erreur console.

#### Phase 3.6 — Undo / Redo robuste (historique fichier byte-exact)
- **`CommandStack`** (`packages/server/src/history.ts`) : pile bornée (100) `undoStack`/`redoStack` de Commands `{ id, label, changes: [{rel, before, after}], timestamp, tokenId?, coalesceKey? }`. Undo réécrit les contenus « before », redo les « after » → restauration exacte (ordre des clés, formatage, références), indépendante de la sémantique.
- **Toutes les mutations enregistrent** : `updateValue`, `createToken`, `deleteToken` (via `commitFile`), `renameToken`, `reorderTokens`, `moveGroup`/`renameGroup` (via `applyRenamesAtomic`), `deleteGroup`/`duplicateToken`/`duplicateGroup` (via `commitStaged`). Une nouvelle mutation vide la `redoStack`.
- **Coalescing** : éditions rapides d'une **même cellule** (`coalesceKey = v:id:mode`, fenêtre 700 ms) fusionnées en un seul item.
- **Anti-désync** : avant un undo/redo, comparaison du contenu disque au snapshot attendu ; si divergence (édition hors outil) → 409 `diverged`, l'UI demande confirmation (`force`).
- **Endpoints** : `POST /api/undo`, `POST /api/redo`, `GET /api/history` ; `history` (canUndo/canRedo/labels) aussi exposé dans `GET /api/state` → l'UI se met à jour à chaque refresh.
- **UI** : boutons ↶/↷ dans le header (désactivés si vide, tooltip = prochain label), raccourcis `⌘Z`/`Ctrl+Z` (undo) + `⌘⇧Z`/`Ctrl+Y` (redo), ignorés quand le focus est dans un champ texte (undo natif). Toast après chaque undo/redo ; le token concerné est re-révélé.
- **Limite connue** : un drag multi-sélection produit encore N items (un par rename serveur) — regroupement en un seul item à faire avec un endpoint batch-rename (lié à 3.5.3).

#### Phase 3.5.5 — Édition rapide spécifique par type (frontend, `variables-table`)
- **Color** : clic sur une cellule couleur littérale → popover avec `input type=color` natif + champ hex/css libre (Apply/Cancel/Esc + backdrop). Écrit la valeur choisie (undoable).
- **Dimension/number** : en édition, steppers ▲▼ + `↑/↓` incrémentent/décrémentent (Shift = ±10) en préservant l'unité ; commit au blur/Enter.
- **Composites** (typography/shadow/border/gradient/transition) : double-clic → éditeur « expand-in-place » listant chaque sous-propriété de `$value` ; réécrit l'objet entier en préservant les types `number`. Nouvelle fixture `examples/multimode/tokens/typography.json` pour démo/vérif.

### 2026-06-09 — Drag/édition façon Figma, résolution multi-mode, gestionnaire de config

Gros chantier sur l'édition Figma-like, la robustesse du drag, la résolution d'alias multi-mode/multi-collection, et un gestionnaire de config dans Settings. Tout vérifié : **37 tests core + 31 tests serveur**, typecheck strict clean (5 packages), `web` build OK. Les gestes de drag CDK ne se simulent pas en headless → **à tester à la souris** ; tout le reste est vérifié via API HTTP + events DOM, et plusieurs fixes sur les données réelles d'un projet de test.

#### Corrections majeures (correctness)
- **PROBLÈME #1 — mutations sur collections « mode-repliées » (RÉSOLU).** `reorder` / `moveGroup` / `moveTokens`(rename) échouaient sur les collections où un segment de chemin est replié en colonnes de mode (chemin logique ≠ physique). Helper `ProjectManager.physicalPaths(collection, logicalPath)` : réinsère le segment de mode à `dimension`, **une fois par mode** ; appliqué à reorder/rename/moveGroup. Rewrite des références reste **logique**.
- **Alias namespace de collection (RÉSOLU, gros impact).** `{primitive.green.500}` nomme la **collection** en 1er segment (le token est à `green.500` dans `primitives`) — convention Tokens Studio/PrimeNG. `core/resolver.ts` mappe `collectionNamespaces` (nom + segments `/` + variante singulier/pluriel) et y retombe quand le chemin littéral n'existe pas. **534 → 0** broken-alias sur les vraies données PrimeNG.
- **cross-collection-order rétrogradé en warning + résout.** Un alias vers une collection « plus tardive » dans l'ordre n'est plus une erreur bloquante (l'alias ne résolvait pas) mais un **warning** ; la valeur résout quand même. L'ordre redevient indicatif (départage les chemins ambigus), pas une barrière.
- **Snapshot des collections (modeDimension auto-détecté).** En verrouillant une config, le `modeDimension` auto-détecté (dans `this.modeDims`, pas dans le runtime) est désormais capturé — sinon le repliage cassait et créait des broken-alias internes.
- **Messages d'erreur.** `errMessage(err)` extrait `err.error.diagnostics[0].message` d'un `HttpErrorResponse` (un 422 affichait « [object Object] »).

#### Drag & drop (parité Figma)
- **Registre partagé** `GroupDropRegistry` : tous les drop-lists (niveaux sidebar `gt-*`, zones « into » par dossier `gt-into-*`, sections tableau `sec-*`) connectés, + cible active (`activeTarget`) pour l'indicateur de drop.
- **Routage par type** via `cdkDropListEnterPredicate` : listes de niveau ⇒ groupes (reorder/re-nest) ; zones « into » + sections ⇒ tokens (drop-dans-dossier, pas de ligne d'insertion). Évite que les deux gestes se gênent.
- **Reorder intra-niveau fiable** : `idsDeepestFirst` ordonne `connectedTo` du plus profond au moins profond ⇒ CDK choisit la liste interne sous le pointeur (avant : le drag « sortait » du sous-groupe).
- **Précision du drag-bas** : placeholder du tableau forcé à la hauteur exacte d'une ligne (41px).
- **Drag plein-élément** : `cdkDragHandle` retiré ; la ligne entière est saisissable, curseur grab seulement sur le ⠿.
- **Drop tableau → dossier sidebar**, indicateur visuel sur le dossier cible, ligne d'insertion noire pour le reorder.
- **Dédup au move** : suffixe `name2` si collision dans le groupe cible (au lieu d'échouer).

#### Édition Figma-like
- **Multi-sélection** (tokens + groupes) déplacée dans `ProjectStore` (partagée table↔sidebar) ; visuel = barre d'accent + fond forge.
- **Rename inline** au double-clic (variable du tableau → `renameTokenLeaf` ; groupe sidebar → `renameGroup`).
- **Menu contextuel** (clic droit) : `core/context-menu.service.ts` + `ui/context-menu.component.ts`. Tableau = Edit variable / Rename / Duplicate / Delete (×N si multi-sel) ; sidebar = Rename / Duplicate / Delete group.
- **Édition cellule = double-clic** ; clic sur un **chip alias** ouvre le **picker** (recherche).
- **Autocomplete alias** : dropdown filtré **par type** (un `number` ne propose pas de couleurs) avec **preview de la valeur résolue** (swatch couleur / valeur). Icône **lien** sur les littéraux pour relier un alias.
- **Chip alias** : preview de la valeur résolue (bullet couleur / valeur).
- **(i) alias multi-mode** : quand la cible d'un alias a plusieurs modes, une icône ⓘ au survol liste ses valeurs résolues par mode (endpoint `GET /api/tokens` + index global `globalByPath`).
- **État actif sidebar** : barre forge sur le groupe actif **et ses ancêtres** (voir le niveau courant).

#### Réactivité
- Updates **optimistes** (`updateValue`/`reorder`) + `refresh()` **coalescé** (un mutation émet 3 events WS → 1 seul refetch).

#### Gestionnaire de config (Settings)
- Icône settings agrandie ; modal **en onglets** (General / Resolution / Collections & modes).
- **Réglables éditables** (persistés `PATCH /api/config`) : strict, infer, normalizeOnSave, writeDebounceMs, crossCollection, maxAliasDepth, **ordre de résolution** (↑/↓, préservé au reload).
- **Modes par collection** : pour les modes-par-fichier (primitives PrimeNG) → renommer/remapper fichier→mode ; **dimension de mode manuelle** quand l'auto-détection échoue (ex. `responsive` : niveau 0 = desktop/tablet/mobile → repliage en colonnes) ; sinon lecture seule. Éditer verrouille la config (`autoGenerated:false`, plus de re-détection).
- **Diagnostics « Go to token »** réparé : `revealTokenById` résout la collection (`GET /api/tokens/:id`), bascule, vide les filtres, sélectionne + scroll + anneau forge.

#### Backend (endpoints ajoutés)
`POST /api/groups/{rename,delete,duplicate}`, `POST /api/tokens/:id/duplicate`, `GET /api/tokens` (tous les tokens), `PATCH /api/config` étendu (réglages + collections + order). Schémas dans `@tokenflow/shared`.

#### Exemples
- `examples/multimode/` : fixture mode-repliée (theme.tokens : modeLight/modeDark) + `responsive.json` (desktop/tablet/mobile non auto-détectés → démontre la dimension manuelle ; donne 2 collections pour tester l'ordre). Le preview pointe dessus (`.claude/launch.json`).

### État antérieur (avant cette session)
Phases 1 & 2 complètes ; Phase 3 partielle ; Phase 3.5 ~80 %. Voir [plan.md](plan.md).

## À faire (prochaines reprises)
1. **Batch-RENAME** (`/api/tokens/batch` ne gère que les valeurs) : un move/drag multi-sélection produit encore N renames → N items d'historique. Un endpoint batch-rename les regrouperait en une Command.
2. **Actions de masse `deprecated`** : ajouter une mutation `metadata` (`$deprecated`) + l'exposer dans le menu contextuel multi-sélection.
3. **Vérifier à la souris** les gestes de drag CDK (reorder, move, re-nest, drop table→dossier) — non simulables en headless.
4. Données : la `semantics.json` PrimeNG contient ~10 `"$value": "{"` (alias incomplets dans la **source**) — affichés tels quels, normal.
5. Phase 3 restant : color picker **OKLCH** (gamut sRGB/P3 ; le picker 3.5.5 est hex/css natif), `$extends`, ajout/rename/suppr de mode, virtualisation CDK.
