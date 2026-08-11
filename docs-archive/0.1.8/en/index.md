---
icon: lucide/home
---

# Token Flow Manager

Local **Design Tokens** manager. Visualize, edit and govern your **DTCG 2025.10**
token files from a visual dashboard, without leaving your project.

It starts a local server on your machine, parses every `*.tokens.json`, resolves
aliases across collections and modes, and opens a dashboard in your browser. It
**never** commits: it edits the source JSON in place, atomically, preserving key
order and formatting. Run it with no path and a welcome screen lets you open a recent
project or browse for one.

[Get started :material-arrow-right:](getting-started.md){ .md-button .md-button--primary }
[View on GitHub :fontawesome-brands-github:](https://github.com/robinlopez/token-flow-manager){ .md-button }

## Highlights

- **Welcome screen** with recent projects and a native folder picker.
- **Variables table**: mode columns (light/dark/brand and more), alias chips, inline editing.
- **Finder-style sidebar**: drag-and-drop to nest or reorder token groups.
- **Copy / Cut / Paste** whole variables, **Undo / Redo**, search, command palette.
- **Diagnostics** with one-click quick-fixes and an alias-chain inspector.

A full tour lives on the [Features](features.md) page.

!!! note "Format-preserving by design"

    Token Flow Manager edits your source JSON **in place**, atomically, keeping key
    order and formatting intact. Diffs stay minimal and reviewable.
