---
icon: lucide/wrench
---

# Development

## Monorepo layout

| Package | Role |
|---|---|
| `@tokenflow/shared` | Zod schemas + types: DTCG nodes, internal model, diagnostics, config, API payloads. |
| `@tokenflow/core` | Engine: DTCG parser (source positions), alias resolver, value validator, format-preserving document mutation. |
| `@tokenflow/server` | Fastify REST + WebSocket, `Session`, `ProjectManager`, chokidar watcher, atomic writes with rotating backups. |
| `token-flow-manager` (CLI) | `npx` entry point (commander). Self-contained bundle that inlines the workspace packages and embeds the built dashboard. |
| `@tokenflow/web` | Angular dashboard: welcome screen, shell, sidebar, variables table, inspector, realtime. |

## Setup

```bash
pnpm install
pnpm -r --filter "./packages/*" test      # run unit + integration tests
pnpm -r --filter "./packages/*" typecheck # strict TS across the board
```

## Build order

Build **in dependency order**. The CLI build embeds the freshly-built dashboard, so
`@tokenflow/web` must be built **before** `token-flow-manager`:

```bash
pnpm --filter @tokenflow/shared build
pnpm --filter @tokenflow/server build
pnpm --filter @tokenflow/web build
pnpm --filter token-flow-manager build    # bundles the CLI + embeds the SPA into dist/web
```

Run against a demo project, or with no path for the welcome screen:

```bash
node packages/cli/dist/cli.js ./examples/basic   # open a project
node packages/cli/dist/cli.js                     # welcome screen
```

## Desktop app (.dmg / .app / .exe)

A native desktop app is built with **Tauri**: the window loads the bundled Angular
dashboard, and a **sidecar** (the server compiled to a single binary with
`bun build --compile`) runs the API.

```bash
# Requires the Rust toolchain (https://rustup.rs) + Bun, once.
pnpm install
pnpm desktop:build      # → src-tauri/target/release/bundle/{dmg,macos}/…
```

Build on each target OS for its installer (`.dmg` on macOS, `.msi`/`.exe` via NSIS on
Windows, `.AppImage`/`.deb` on Linux).

## Working on this documentation

The docs are built with [Zensical](https://zensical.org). From the repo root:

```bash
pnpm docs:dev          # English preview with live reload at http://localhost:8000
pnpm docs:dev:fr       # French preview
pnpm docs:build        # build the static site (EN + FR) into ./site
```

English is served at the root, French under `/fr/`. Each language has its own config
file (`zensical.toml` and `zensical.fr.toml`); keep them in sync when you change a
setting. Pushing to `master` automatically rebuilds and deploys both languages to
GitHub Pages via `.github/workflows/docs.yml`.
