import { gunzipSync } from 'node:zlib';
import { existsSync, lstatSync, statSync, type Stats } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type {
  ScaffoldTemplateRequest,
  ScaffoldTemplateResult,
  TemplateLogo,
  TemplateOrigin,
  TokenTemplate,
} from '@tokenflow/shared';
import {
  TEMPLATE_PAYLOADS,
  type TemplatePayload,
  type TemplatePayloadFile,
} from './data.generated.js';

/**
 * Starter design-system templates.
 *
 * Human metadata lives here; the token payloads (and the counts derived from
 * them) are generated into `data.generated.ts` from `packages/server/templates/`
 * (see `scripts/gen-templates.mjs`).
 *
 * Scaffolding writes the files verbatim, `manifest.json` included: the manifest
 * is the organization source of truth the app (and the Figma plugin) reads, so a
 * scaffolded folder opens with its collections and mode columns already set up,
 * with no auto-detection guesswork.
 */

interface TemplateMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  origin: TemplateOrigin;
  logo: TemplateLogo;
  accent: string;
  url?: string;
  suggestedFolder: string;
}

/** Display order on the welcome screen. */
const CATALOG: TemplateMeta[] = [
  {
    id: 'tailwind-v4',
    name: 'Tailwind CSS v4',
    tagline: 'The default Tailwind palette and scales, as tokens.',
    description:
      'Official Tailwind CSS v4 tokens: full colour palette (50–950 across all hues), ' +
      'metrics (spacing, radius, border widths, opacity, blur, breakpoints, containers, ' +
      'font sizes / weights / leading / tracking) and the typography text styles.',
    origin: 'official',
    logo: 'tailwind',
    accent: '#38BDF8',
    url: 'https://tailwindcss.com/docs/theme',
    suggestedFolder: 'design-tokens',
  },
  {
    id: 'material-design-3',
    name: 'Material Design 3',
    tagline: "Google's baseline colour, typescale and shape system.",
    description:
      'Material Design 3 baseline: the colour system as 32 schemes (light and dark, each ' +
      'with medium and high contrast, plus 13 accent themes), the state layers and add-on ' +
      'roles, the Baseline typescale, two font themes and the shape scale. Text and effect ' +
      'styles included.',
    origin: 'official',
    logo: 'material',
    accent: '#6750A4',
    url: 'https://m3.material.io/styles',
    suggestedFolder: 'design-tokens',
  },
  {
    id: 'semantic-functional-ds',
    name: 'Semantic Functional DS',
    tagline: 'Multi-brand, strict semantic naming, functional intent families.',
    description:
      'A multi-brand design system with strict semantic naming and functional intent ' +
      'families (actions, form, informative, navigation, table). Primitives across 3 brands, ' +
      'semantics in Light / Dark, plus metrics, typography, responsive, utils, breakpoints ' +
      'and transitions. The most opinionated starter: pick it to inherit a naming discipline.',
    origin: 'community',
    logo: 'semantic-ds',
    accent: '#9747FF',
    suggestedFolder: 'design-tokens',
  },
  {
    id: 'simple-design-system-figma',
    name: 'Simple Design System',
    tagline: 'The popular Figma Community starter kit.',
    description:
      'Figma Community starter: a small, widely-used design system with Color Primitives, ' +
      'Color (SDS Light / SDS Dark), Typography Primitives, Typography, Size and Responsive ' +
      'collections. The gentlest starting point: few tokens, clear structure.',
    origin: 'community',
    logo: 'figma',
    accent: '#F24E1E',
    url: 'https://www.figma.com/community/file/1250021429298581396',
    suggestedFolder: 'design-tokens',
  },
];

/** Figma text/effect styles are shipped in this conventional file name. */
const STYLES_FILE = 'styles.tokens.json';

/** The catalog as the API exposes it (metadata + generated counts). */
export function listTemplates(): TokenTemplate[] {
  const out: TokenTemplate[] = [];
  for (const meta of CATALOG) {
    const payload = TEMPLATE_PAYLOADS[meta.id];
    if (!payload) continue; // metadata without a payload: skip rather than 500
    out.push({
      ...meta,
      collections: payload.collections.map((c) => ({
        name: c.name,
        modes: [...c.modes],
        tokenCount: c.tokenCount,
      })),
      tokenCount: payload.tokenCount,
      fileCount: payload.files.length,
      bytes: payload.bytes,
      hasStyles: payload.files.some((f) => f.name === STYLES_FILE),
    });
  }
  return out;
}

export function getTemplate(id: string): TokenTemplate | null {
  return listTemplates().find((t) => t.id === id) ?? null;
}

/**
 * Payload for a client-supplied id.
 *
 * `hasOwn` rather than a bare index: plain-object indexing walks the prototype
 * chain, so ids like `constructor` or `__proto__` would come back truthy and
 * sail past a `!payload` guard.
 */
function payloadFor(id: string): TemplatePayload | null {
  return Object.hasOwn(TEMPLATE_PAYLOADS, id) ? (TEMPLATE_PAYLOADS[id] as TemplatePayload) : null;
}

/** Inflate one embedded template file back to its original bytes. */
function inflate(file: TemplatePayloadFile): Buffer {
  return gunzipSync(Buffer.from(file.gz, 'base64'));
}

/**
 * Absolute path of `name` inside `dir`, or null if it would land anywhere else.
 *
 * The names come from our own embedded catalog, so this can only fire on a
 * corrupted payload, but scaffolding writes into a directory the user named and
 * that is not a place to rely on an invariant holding elsewhere.
 */
function containedPath(dir: string, name: string): string | null {
  const abs = resolve(dir, name);
  return abs.startsWith(dir + sep) && basename(abs) === name ? abs : null;
}

/**
 * Write a template into `parent[/folder]`, creating the folder if needed.
 *
 * Nothing is written when a same-named entry is already there, unless
 * `overwrite` is set: the conflicting names come back in the result so the UI
 * can name them. A symlink is always a conflict and is never followed, so
 * `overwrite` can only ever replace a regular file inside the target folder.
 */
export async function scaffoldTemplate(req: ScaffoldTemplateRequest): Promise<ScaffoldTemplateResult> {
  const fail = (error: string, path = '', conflicts: string[] = []): ScaffoldTemplateResult => ({
    ok: false,
    path,
    files: [],
    conflicts,
    error,
  });

  const payload = payloadFor(req.templateId);
  if (!payload) return fail(`Unknown template: ${req.templateId}`);

  const parent = resolve(req.parent);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    return fail(`Not a directory: ${parent}`);
  }

  const folder = req.folder?.trim();
  const target = folder ? join(parent, folder) : parent;
  if (existsSync(target) && !statSync(target).isDirectory()) {
    return fail(`Not a directory: ${target}`, target);
  }

  // Resolve every destination up front: one bad name aborts before any write.
  const writes: { abs: string; file: TemplatePayloadFile }[] = [];
  for (const file of payload.files) {
    const abs = containedPath(target, file.name);
    if (!abs) return fail(`Refusing to write outside ${target}: ${file.name}`, target);
    writes.push({ abs, file });
  }

  // `lstat`, not `existsSync`: a dangling symlink still occupies the name, and a
  // live one must not be followed out of the folder the user chose.
  const conflicts = writes.filter((w) => lstatSyncSafe(w.abs) !== null).map((w) => w.file.name);
  const symlinks = writes
    .filter((w) => lstatSyncSafe(w.abs)?.isSymbolicLink())
    .map((w) => w.file.name);
  if (symlinks.length > 0) {
    return fail(
      `Refusing to write through a symlink in ${target}: ${symlinks.join(', ')}`,
      target,
      conflicts,
    );
  }
  if (conflicts.length > 0 && !req.overwrite) {
    return fail('Some files already exist', target, conflicts);
  }

  await mkdir(target, { recursive: true });
  const written: string[] = [];
  for (const { abs, file } of writes) {
    await writeFile(abs, inflate(file));
    written.push(file.name);
  }
  return { ok: true, path: target, files: written, conflicts: [] };
}

/** `lstatSync` that reports "nothing there" as null instead of throwing. */
function lstatSyncSafe(abs: string): Stats | null {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
}
