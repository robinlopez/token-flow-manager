import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import { parseFile, detectModeDimension } from '@tokenflow/core';
import {
  DEFAULT_CONFIG,
  TokenflowConfigSchema,
  type CollectionConfig,
  type OrganizationSource,
  type SetupIssue,
  type TokenflowConfig,
} from '@tokenflow/shared';
import {
  detectOrgManifest,
  parseOrgManifest,
  readOrgManifestRaw,
  ORG_MANIFEST_NAME,
} from './manifest-org.js';

const CANDIDATES = [
  'tokenflow.config.ts',
  'tokenflow.config.js',
  'tokenflow.config.mjs',
  'tokenflow.config.json',
];

/** JSON files that are clearly not design tokens — never auto-collected. */
const NON_TOKEN_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'angular.json',
  'composer.json',
  'manifest.json',
]);

export interface LoadedConfig {
  config: TokenflowConfig;
  /** Absolute path of the config file, or null if auto-detected. */
  source: string | null;
  /** Where token organization (collections/modes) came from. */
  organizationSource: OrganizationSource;
  /** Structural problems found while deriving collections (manifest mapping). */
  manifestIssues: SetupIssue[];
}

/** Read tool-preference settings from a config file (collections/order ignored). */
async function loadSettings(root: string): Promise<{
  resolution: TokenflowConfig['resolution'];
  writeDebounceMs: number;
  strictTypes: boolean;
  inferTypes: boolean;
}> {
  for (const name of CANDIDATES) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      let parsed: TokenflowConfig;
      if (name.endsWith('.json')) {
        // Tolerate a settings-only config (no collections) by injecting a stub.
        const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        if (!Array.isArray(raw['collections']) || (raw['collections'] as unknown[]).length === 0) {
          raw['collections'] = [{ name: '__settings__', files: '__none__' }];
        }
        parsed = TokenflowConfigSchema.parse(raw);
      } else {
        const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
        parsed = TokenflowConfigSchema.parse(mod.default ?? mod);
      }
      return {
        resolution: { ...parsed.resolution, order: undefined },
        writeDebounceMs: parsed.writeDebounceMs,
        strictTypes: parsed.strictTypes,
        inferTypes: parsed.inferTypes,
      };
    } catch {
      break;
    }
  }
  return {
    resolution: { crossCollection: true, maxAliasDepth: 10 },
    writeDebounceMs: 200,
    strictTypes: false,
    inferTypes: true,
  };
}

/**
 * Load the project config from `root`. Organization (collections/modes) comes
 * from `manifest.json` when present (the source of truth, ISO with the Figma
 * plugin); otherwise from a legacy `tokenflow.config.json` with collections, or
 * auto-detection. Tool preferences always come from `tokenflow.config.json`.
 */
export async function loadConfig(root: string): Promise<LoadedConfig> {
  // Highest priority: an organization manifest.
  if (detectOrgManifest(root)) {
    try {
      const raw = await readOrgManifestRaw(join(root, ORG_MANIFEST_NAME));
      const { collections, issues } = await parseOrgManifest(root, raw);
      if (collections.length > 0) {
        const settings = await loadSettings(root);
        return {
          config: TokenflowConfigSchema.parse({
            collections,
            resolution: { ...settings.resolution, order: collections.map((c) => c.name) },
            writeDebounceMs: settings.writeDebounceMs,
            strictTypes: settings.strictTypes,
            inferTypes: settings.inferTypes,
          }),
          source: join(root, ORG_MANIFEST_NAME),
          organizationSource: 'manifest',
          manifestIssues: issues,
        };
      }
    } catch {
      /* malformed manifest → fall through to config/auto-detect */
    }
  }

  for (const name of CANDIDATES) {
    const file = join(root, name);
    if (!existsSync(file)) continue;

    let raw: Record<string, unknown>;
    try {
      if (name.endsWith('.json')) {
        raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      } else {
        const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
        raw = (mod.default ?? mod) as Record<string, unknown>;
      }
    } catch {
      break; // unparseable config → fall through to auto-detection
    }

    // A settings-only config (no collections) — e.g. a manifest project whose
    // manifest was later removed. Keep the tool preferences and derive the
    // organization by auto-detection instead of throwing on the missing field.
    const hasCollections = Array.isArray(raw['collections']) && raw['collections'].length > 0;
    if (!hasCollections) {
      return autoOrganization(root, await loadSettings(root));
    }

    let parsed: TokenflowConfig;
    try {
      parsed = TokenflowConfigSchema.parse(raw);
    } catch {
      // Malformed but has *some* collections key → don't crash; auto-detect.
      return autoOrganization(root, await loadSettings(root));
    }

    // Hand-authored config with collections is authoritative (legacy organization).
    if (!parsed.autoGenerated) {
      return { config: parsed, source: file, organizationSource: 'config', manifestIssues: [] };
    }

    // Auto-generated config persists ONLY settings — re-detect collections so a
    // manifest / newly-added files always take effect.
    return autoOrganization(root, {
      resolution: parsed.resolution,
      writeDebounceMs: parsed.writeDebounceMs,
      strictTypes: parsed.strictTypes,
      inferTypes: parsed.inferTypes,
    });
  }

  return autoOrganization(root, await loadSettings(root));
}

type Settings = Awaited<ReturnType<typeof loadSettings>>;

/** Build an auto-detected-organization config that preserves tool preferences. */
async function autoOrganization(root: string, settings: Settings): Promise<LoadedConfig> {
  const collections = await detectCollections(root);
  const base =
    collections.length > 0
      ? { collections, resolution: { ...settings.resolution, order: collections.map((c) => c.name) } }
      : { collections: DEFAULT_CONFIG.collections, resolution: settings.resolution };
  return {
    config: TokenflowConfigSchema.parse({
      ...base,
      writeDebounceMs: settings.writeDebounceMs,
      strictTypes: settings.strictTypes,
      inferTypes: settings.inferTypes,
    }),
    source: null,
    organizationSource: 'auto',
    manifestIssues: [],
  };
}

/** Manifest-derived collections if a manifest exists, otherwise auto-detected. */
export async function detectCollections(root: string): Promise<CollectionConfig[]> {
  const manifest = await loadManifest(root);
  if (manifest && manifest.length > 0) return manifest;
  return autoDetectCollections(root);
}

interface ManifestTheme {
  name: string;
  primitiveFile: string;
}
interface ManifestTokenEntry {
  enabled?: boolean;
  sourceFile?: string;
  sourcePath?: string;
}
interface Manifest {
  themes?: ManifestTheme[];
  tokens?: Record<string, ManifestTokenEntry>;
}

const MANIFEST_CANDIDATES = ['token-config.json', 'tokens.config.json'];

/**
 * Read a project manifest (token-config.json) and derive collections.
 *  - Per-theme primitive files collapse into one "primitives" collection with
 *    file-based modes (one mode per theme).
 *  - Each `tokens.<name>.sourceFile` becomes its own collection.
 */
export async function loadManifest(root: string): Promise<CollectionConfig[] | null> {
  let manifest: Manifest | null = null;
  for (const name of MANIFEST_CANDIDATES) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as Manifest;
      if (raw && typeof raw === 'object' && (raw.themes || raw.tokens)) {
        manifest = raw;
        break;
      }
    } catch {
      /* not a usable manifest */
    }
  }
  if (!manifest) return null;

  const collections: CollectionConfig[] = [];

  // Primitives: one collection, file-based theme modes.
  const primSrc = manifest.tokens?.['primitives']?.sourcePath;
  if (manifest.themes?.length && primSrc) {
    const base = primSrc.replace(/\/+$/, '');
    const files: string[] = [];
    const fileModes: Record<string, string> = {};
    for (const theme of manifest.themes) {
      if (!theme.primitiveFile) continue;
      const rel = `${base}/${theme.primitiveFile}`;
      if (!existsSync(join(root, rel))) continue;
      files.push(rel);
      fileModes[rel] = theme.name;
    }
    if (files.length > 0) {
      collections.push({
        name: 'primitives',
        files,
        modes: manifest.themes.map((t) => t.name),
        fileModes,
      });
    }
  }

  // Other token groups: single-file collections.
  for (const [name, entry] of Object.entries(manifest.tokens ?? {})) {
    if (name === 'primitives') continue;
    if (entry.enabled === false) continue;
    if (!entry.sourceFile || !existsSync(join(root, entry.sourceFile))) continue;
    collections.push({ name, files: entry.sourceFile });
  }

  return collections;
}

/** Discover token-like JSON files and map each to a single-file collection. */
export async function autoDetectCollections(root: string): Promise<CollectionConfig[]> {
  const matches = await fg('**/*.json', {
    cwd: root,
    // Skip unreadable dirs (e.g. ~/.Trash, protected ~/Library) instead of throwing —
    // a user may open any folder from the welcome screen, including their home.
    suppressErrors: true,
    followSymbolicLinks: false,
    deep: 6,
    ignore: [
      '**/node_modules/**',
      '**/.tokenflow/**',
      '**/dist/**',
      '**/.git/**',
      '**/.temp-tokens/**', // generated build output
      '**/.*/**', // hidden dirs: caches, .Trash, version-control internals, etc.
      '**/Library/**', // macOS system/app data — huge and partly protected
    ],
  });

  const collections: CollectionConfig[] = [];
  for (const rel of matches.sort()) {
    const base = rel.split('/').pop()!;
    if (NON_TOKEN_NAMES.has(base) || base.endsWith('.config.json')) continue;
    let content: string;
    try {
      content = await readFile(join(root, rel), 'utf8');
      // Cheap structural check: must look like a token document.
      if (!content.includes('"$value"') && !content.includes('"value"')) continue;
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    } catch {
      continue;
    }

    const collection: CollectionConfig = { name: collectionName(rel), files: rel };

    // Detect a path-segment mode dimension (modeLight/modeDark style).
    const { tokens } = parseFile(content, {
      file: rel,
      collection: collection.name,
      modes: [],
      defaultMode: 'default',
    });
    const dim = detectModeDimension(tokens.map((t) => t.path));
    if (dim) {
      collection.modes = dim.modes;
      collection.modeDimension = dim.dimension;
    }

    collections.push(collection);
  }
  return collections;
}

/** Collection name from a file path: drop the .json extension, keep folders. */
function collectionName(rel: string): string {
  return rel.replace(/\.json$/i, '');
}
