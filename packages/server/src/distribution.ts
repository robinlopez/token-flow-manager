import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DistributionCollection,
  NpmScript,
  TokenConfigManifest,
} from '@tokenflow/shared';
import { TokenConfigManifestSchema } from '@tokenflow/shared';

/**
 * Phase 4 — `token-config.json` manifest adapter (parse / serialize / defaults).
 *
 * The manifest drives a project-owned build script. JSON round-trips: the edited
 * model is merged back over the on-disk object so hand-tuned keys are preserved.
 */

/** Manifest filenames checked at the project root. */
export const MANIFEST_CANDIDATES = ['token-config.json', 'tokens.config.json'];

/** Locate an existing manifest at the project root (relative path), or null. */
export function detectManifest(root: string): string | null {
  for (const name of MANIFEST_CANDIDATES) if (existsSync(join(root, name))) return name;
  return null;
}

export async function readManifestRaw(abs: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(abs, 'utf8')) as Record<string, unknown>;
}

/** Normalize a raw manifest object into the editable model (defaults filled). */
export function toManifestModel(raw: Record<string, unknown>): TokenConfigManifest {
  // The schema fills defaults; missing top-level objects are tolerated.
  return TokenConfigManifestSchema.parse({
    output: raw['output'] ?? {},
    themeMode: raw['themeMode'] ?? {},
    themes: raw['themes'] ?? [],
    tokens: raw['tokens'] ?? {},
    structure: raw['structure'] ?? {},
    comments: raw['comments'] ?? {},
  });
}

/**
 * Merge the edited model back over the raw on-disk object: modeled sections are
 * replaced (object-merged so unknown keys survive); themes merge by index; token
 * entries merge by key. Top-level unknown keys are preserved.
 */
export function mergeManifestIntoRaw(
  raw: Record<string, unknown>,
  model: TokenConfigManifest,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  out['output'] = { ...asRecord(raw['output']), ...model.output };
  out['themeMode'] = { ...asRecord(raw['themeMode']), ...model.themeMode };

  const rawThemes = Array.isArray(raw['themes']) ? (raw['themes'] as Record<string, unknown>[]) : [];
  out['themes'] = model.themes.map((t, i) => ({ ...(rawThemes[i] ?? {}), ...stripUndefined(t) }));

  const rawTokens = asRecord(raw['tokens']);
  const tokens: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(model.tokens)) {
    tokens[key] = { ...asRecord(rawTokens[key]), ...stripUndefined(entry) };
  }
  out['tokens'] = tokens;

  out['structure'] = { ...asRecord(raw['structure']), ...stripUndefined(model.structure) };
  out['comments'] = { ...asRecord(raw['comments']), ...stripUndefined(model.comments) };
  return out;
}

export function serializeManifest(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Build a sensible starter manifest from the project's collections. Theme files
 * are derived from a file-per-theme collection when present; otherwise a single
 * "default" theme is created. Each collection becomes a token entry.
 */
export function defaultManifest(collections: DistributionCollection[]): TokenConfigManifest {
  // A collection whose name hints at primitives + has >1 mode → file-per-theme.
  const primCol =
    collections.find((c) => /primitive/i.test(c.name) && c.modes.length > 1) ??
    collections.find((c) => c.modes.length > 1 && c.files.length > 1);

  const themes =
    primCol && primCol.modes.length
      ? primCol.modes.map((m, i) => ({
          name: m,
          primitiveFile: baseName(primCol.files[i] ?? primCol.files[0] ?? `${m}.json`),
          objectName: `${m}Primitives`,
        }))
      : [{ name: 'default', primitiveFile: baseName(collections[0]?.files[0] ?? 'primitives.json'), objectName: 'defaultPrimitives' }];

  const tokens: Record<string, ReturnType<typeof tokenEntry>> = {};
  for (const c of collections) {
    tokens[c.name] = tokenEntry(c.files[0]);
  }

  const sourceRoot = commonDir(collections.flatMap((c) => c.files)) || 'src/design-tokens';

  return TokenConfigManifestSchema.parse({
    output: { useCssVariables: true, buildPath: 'src/styles/generated/', exportPrefix: 'theme' },
    themeMode: {
      mode: 'both',
      defaultTheme: themes[0]?.name ?? '',
      lightSelector: ':root',
      darkSelector: "[data-theme='dark'], .dark-mode",
    },
    themes,
    tokens,
    structure: { tempDirectory: '.temp-tokens', sourceRoot },
    comments: { fileHeader: '/* Auto-generated — do not edit */' },
  });
}

function tokenEntry(file?: string) {
  return { enabled: true, ...(file ? { sourceFile: file } : {}), generateTypescript: true, generateScss: true };
}

/** The npm script that runs the build via the project's build script. */
export function npmScriptFor(scriptRel: string): NpmScript {
  return { name: 'generate:tokens', command: `node ${scriptRel.replace(/^\.\//, '')}` };
}

/** Token-related npm scripts already present in package.json. */
export async function readNpmScripts(root: string): Promise<NpmScript[]> {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    return Object.entries(pkg.scripts ?? {})
      .filter(([k, v]) => /token/i.test(k) || /style-dictionary|token/i.test(v))
      .map(([name, command]) => ({ name, command }));
  } catch {
    return [];
  }
}

// ---- internal ----

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}
function baseName(p: string): string {
  return p.split('/').pop() ?? p;
}
function commonDir(files: string[]): string {
  if (files.length === 0) return '';
  const dirs = files.map((f) => dirname(f));
  let prefix = dirs[0]!;
  for (const d of dirs) {
    while (!d.startsWith(prefix) && prefix.length) prefix = prefix.slice(0, prefix.lastIndexOf('/'));
  }
  return prefix;
}
