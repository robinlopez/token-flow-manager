---
icon: lucide/layout-template
---

# Starter templates

You do not need an existing token project to use Token Flow Manager. Launch it with no
path and the **Open a project** card offers a second way in at the bottom: **No project
yet? Start from a template**. Click it and the card slides over to the template picker,
where you choose a design system and a folder; a complete DTCG token structure is written
to disk and opened. The **‹** button slides back.

This is the fastest way to get a **source of truth** you can commit to a repository, with
collections, modes and aliases already in place.

## The four templates

| Template | Origin | What you get |
| --- | --- | --- |
| **Tailwind CSS v4** | Official | The full colour palette (50–950 across every hue) and the metric scales: spacing, radius, border widths, opacity, blur, breakpoints, containers, font sizes / weights / leading / tracking, plus the typography text styles. 2 collections, 434 variables. |
| **Material Design 3** | Official | The colour system as 32 schemes (light and dark, each with medium and high contrast, plus 13 accent themes), state layers and add-on roles, the Baseline typescale, two font themes and the shape scale. 4 collections, 304 variables. |
| **Semantic Functional DS** | Community | A multi-brand system with strict semantic naming and functional intent families (actions, form, informative, navigation, table): primitives across 3 brands, semantics in Light / Dark, plus metrics, typography, responsive, utils, breakpoints and transitions. 8 collections, 467 variables. |
| **Simple Design System** | Community | The popular Figma Community starter: Color Primitives, Color (SDS Light / SDS Dark), Typography Primitives, Typography, Size and Responsive. The gentlest starting point. 6 collections, 347 variables. |

Every card shows its collection and variable counts before you commit to anything, and the
dialog lists each collection with its own variable and mode count.

## Creating a project

1. Click **Start from a template** at the bottom of the *Open a project* card, then pick
   a template from the list. A dialog opens with the full description and what will land on
   disk.
2. Pick the destination with **Browse…** (the native folder dialog, since the server runs
   on your machine) or paste a path.
3. Optionally change the **sub-folder** name. It defaults to `design-tokens`; leave it
   empty to write straight into the folder you picked.
4. Leave **Set up distribution right after** checked to jump into the
   [Distribution](distribution.md) configurator as soon as the project opens: a brand-new
   token set has no build yet.
5. **Create project**.

The files are written, the project opens, and it joins your recent projects like any other.

!!! note "Nothing is overwritten by accident"

    If the destination already holds a file with the same name, nothing is written: the
    dialog names the conflicting files and offers an explicit **Overwrite them** button.

## What lands on disk

A flat folder, no build config, no `package.json`, nothing to install:

```
design-tokens/
├── manifest.json              # the organization: collections → modes → files
├── tailwindcss-colors.json    # DTCG tokens
├── tailwindcss-metrics.json
└── styles.tokens.json         # Figma text + effect styles (when the template has them)
```

`manifest.json` is the part that matters. It is the organization source of truth the
dashboard reads (and it stays interchangeable with the Figma plugin), so a scaffolded
folder opens with its **collections and mode columns already correct** instead of relying
on auto-detection. See [Settings](settings.md) for how organization is resolved.

## Then what?

- **Edit** the tokens like any project: rename, re-nest, add modes, relink aliases.
- **Commit** the folder. It is plain JSON with stable key order, so diffs stay reviewable.
- **Convert** it to the formats your apps need with the
  [Distribution](distribution.md) configurator: CSS variables, SCSS, TypeScript, JSON.
- **Push it to Figma** with the companion plugin, which reads the same `manifest.json`.
