# token-flow-manager

Local Design Tokens manager — visualize, edit and govern your **DTCG 2025.10**
token files from a Figma-Variables-style dashboard, without leaving your project.

It starts a local Node server (bound to `127.0.0.1`), parses every `*.tokens.json`,
resolves aliases across collections and modes, and opens a dashboard in your
browser. It **never** commits — it edits the source JSON in place, atomically,
preserving key order and formatting.

## Install & run

Requires **Node ≥ 20**. Runs in your default browser (no macOS Gatekeeper issues).

```bash
npx token-flow-manager            # welcome screen → pick a project
npx token-flow-manager ./design   # …or open a project directly

npm i -g token-flow-manager       # …or install globally, then just run:
tokenflow                         # opens the welcome screen
tokenflow ./design                # opens a project directly
```

## Commands

```bash
tokenflow [path]      # start server + dashboard (welcome screen if no path)
tokenflow validate    # headless parse + resolve, exits 1 on errors (CI-friendly)
tokenflow init        # scaffold a tokenflow.config.json
```

Options for the default command: `-p, --port <port>`, `--host <host>`,
`--no-open` (don't open the browser), `--no-watch` (don't watch for external changes).

## Features

- **Variables table** — one row per variable, **one column per mode**
  (light / dark / brand…), alias chips, inline editing, resizable columns.
- **OKLCH color picker** with live **sRGB / Display P3** gamut indicators; output as
  `oklch()`, `color(display-p3 …)` or HEX.
- **Cross-collection alias resolution** (`{group.token}` + JSON Pointer) with cycle /
  broken-reference detection and quick-fixes.
- **Modes** as columns: add / rename / delete / duplicate across one-file-per-theme,
  path-dimension and inline `$value` strategies.
- **Byte-exact undo / redo** (⌘Z / ⌘⇧Z), server-side.
- **Sidebar group tree** with Finder-style drag-and-drop, **copy / cut / paste**
  whole variables, full-text **search** (⌘S) + a command palette.
- **Welcome screen** — recent projects + a native OS folder picker; no path on the
  command line required.
- **Distribution** — a guided Style Dictionary v5 configurator with a sandboxed
  test-build report.

## Configuration

Zero-config by default (one collection per `*.tokens.json` file). For multi-collection
projects, run `tokenflow init` to scaffold a `tokenflow.config.json`:

```json
{
  "collections": [
    { "name": "Tokens", "files": "tokens/**/*.tokens.json", "modes": ["light", "dark"] }
  ],
  "resolution": { "crossCollection": true, "order": ["Tokens"], "maxAliasDepth": 10 },
  "writeDebounceMs": 200
}
```

## Links

- **Repository:** https://github.com/robinlopez/token-flow-manager
- **Standard:** [DTCG Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)

## License

MIT
