import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';
import fg from 'fast-glob';
import writeFileAtomic from 'write-file-atomic';
import chokidar, { type FSWatcher } from 'chokidar';
import MiniSearch from 'minisearch';
import {
  parseFile,
  resolveProject,
  parseDocument,
  stringifyDocument,
  detectFormat,
  setTokenValue,
  setTokenDescription,
  setTokenNode,
  getTokenNode,
  getGroupNode,
  deleteTokenNode,
  renameNode,
  rewriteAliasReferences,
  countAliasReferences,
  reorderChildren,
  duplicateModeAtDimension,
  renameModeAtDimension,
  removeModeAtDimension,
  duplicateInlineMode,
  renameInlineMode,
  removeInlineMode,
  wrapValuesAsInline,
  detectModeDimension,
  mergeByModeDimension,
  mergeByPath,
  tokenId,
  validateValue,
  type RawToken,
  type CollectionInput,
  type JsonObject,
} from '@tokenflow/core';
import { isAlias, isCompositeType, parseAliasPath } from '@tokenflow/shared';
import { detectCollections, loadConfig } from './config-loader.js';
import {
  ORG_MANIFEST_NAME,
  detectOrgManifest,
  readOrgManifestRaw,
  serializeOrgManifest,
  serializeOrgManifestText,
} from './manifest-org.js';
import { CommandStack, type FileChange, type HistoryState } from './history.js';
import {
  type Collection,
  type CollectionSummary,
  type Diagnostic,
  type GroupNode,
  type ParsedToken,
  type ProjectState,
  type ProjectSetup,
  type SetupIssue,
  type OrganizationSource,
  type ModeDefinition,
  type TokenflowConfig,
  type CreateTokenRequest,
  type MutationResult,
  type ReferenceInfo,
  type RenamePreview,
  type SearchFilters,
  type SearchHit,
  type SearchResponse,
  type DistributionState,
  type DistributionCollection,
  type TokenConfigManifest,
  type DistMatrix,
  type DistConfig,
  type DistBuildReport,
  type WriteDistributionResult,
  type LinkedConfig,
  matrixToConfig,
  DistConfigSchema,
  makeDiagnostic,
} from '@tokenflow/shared';
import { detectSdVersion, runTestBuild, generateV5Script, runExternalCommand } from './distribution-v5.js';
import { generateResolverScript, runResolverBuild } from './distribution-resolver.js';
import { proposeConfig, type ProposeCollection } from './distribution-propose.js';
import {
  detectManifest,
  readManifestRaw,
  toManifestModel,
  mergeManifestIntoRaw,
  serializeManifest,
  defaultManifest,
  npmScriptFor,
  readNpmScripts,
  MANIFEST_CANDIDATES,
} from './distribution.js';
import { buildTokensScript } from './build-tokens-template.js';

interface FileEntry {
  abs: string;
  rel: string;
  collection: string;
  content: string;
  hash: string;
  readOnly: boolean;
}

/** Metadata attached to a recorded history Command. */
interface HistoryMeta {
  label: string;
  tokenId?: string;
  coalesceKey?: string;
}

/** Outcome of an undo/redo request (for the route + UI). */
export interface UndoRedoResult {
  ok: boolean;
  /** Why it could not proceed: nothing to undo/redo, or files diverged on disk. */
  reason?: 'empty' | 'diverged';
  /** Label of the command that was (or would be) undone/redone. */
  label?: string;
  /** Token to re-select in the UI afterwards. */
  tokenId?: string;
  /** Files whose on-disk content no longer matches the recorded snapshot. */
  diverged?: string[];
}

interface CollectionRuntime {
  name: string;
  modes: string[];
  defaultMode: string;
  modeDimension?: number;
  /** Relative file path → mode, for file-based (one-file-per-theme) modes. */
  fileModes?: Map<string, string>;
  /** Internal mode id (physical segment) → display name from the manifest. */
  modeLabels?: Map<string, string>;
}

/** How a collection physically stores its modes (drives add/rename behaviour). */
type ModeStorage = 'file' | 'dimension' | 'inline' | 'none';

interface ModeInfo {
  storage: ModeStorage;
  modes: string[];
  defaultMode: string;
  /** Path depth carrying the mode segment (storage === 'dimension'). */
  dimension?: number;
  /** Relative file → mode map (storage === 'file'). */
  fileModes?: Map<string, string>;
}

const BACKUP_DIR = '.tokenflow/backups';
const BACKUP_ROTATION = 50;

function hashContent(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/**
 * In-memory authority over a project's token files. Loads, resolves, mutates
 * (with atomic writes + backups), and watches for external changes.
 */
export class ProjectManager extends EventEmitter {
  readonly root: string;
  private config: TokenflowConfig;
  private readonly runtimes = new Map<string, CollectionRuntime>();
  private files = new Map<string, FileEntry>();
  private collections = new Map<string, Collection>();
  private tokensById = new Map<string, ParsedToken>();
  private diagnostics: Diagnostic[] = [];
  private searchIndex: MiniSearch | null = null;
  /** Token ids that are referenced by at least one alias (for orphan detection). */
  private referencedIds = new Set<string>();
  /** pathKey -> token entries across collections, for alias target resolution. */
  private byPathKey = new Map<string, Array<{ id: string; collection: string; rank: number }>>();
  /**
   * Lowercased collection-namespace -> collection name (Tokens Studio / PrimeNG
   * convention: `{primitive.green.500}` names the collection, not a path
   * segment). Mirrors the resolver so reference/orphan detection matches what
   * actually resolves.
   */
  private collectionNamespaces = new Map<string, string>();
  /** Effective modes per collection (declared OR auto-detected from a path dimension). */
  private effectiveModes = new Map<string, string[]>();
  /** Active path-segment mode dimension per collection (logical↔physical path translation). */
  private modeDims = new Map<string, { dimension: number; modes: string[] }>();
  /** Byte-exact file-level undo/redo history (Phase 3.6). */
  private readonly history = new CommandStack();
  /** Set while a structural op (modes/collections) runs, so the config + token
   * file snapshot can be captured before/after and recorded as one undoable command. */
  private structuralCapture: { before: Map<string, string | null> } | null = null;
  /** Relative path of the project config (snapshotted alongside files for structural undo). */
  private readonly configRel = 'tokenflow.config.json';
  private watcher: FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  /** True when collections were auto-detected (no config file) — re-detect on reload. */
  private autoDetect: boolean;
  /** Where token organization comes from — drives manifest-vs-config persistence + onboarding. */
  private organizationSource: OrganizationSource;
  /** Structural issues from deriving collections (manifest mapping); surfaced in getState().setup. */
  private manifestIssues: SetupIssue[];

  constructor(
    root: string,
    config: TokenflowConfig,
    opts: { autoDetect?: boolean; organizationSource?: OrganizationSource; manifestIssues?: SetupIssue[] } = {},
  ) {
    super();
    this.root = resolve(root);
    this.config = config;
    this.autoDetect = opts.autoDetect ?? false;
    this.organizationSource = opts.organizationSource ?? (this.autoDetect ? 'auto' : 'config');
    this.manifestIssues = opts.manifestIssues ?? [];
    // A hand-authored config (not auto-detected) is already authoritative — keep
    // its collections locked so settings edits don't downgrade it to auto.
    this.collectionsLocked = !this.autoDetect;
    this.rebuildRuntimes();
  }

  private rebuildRuntimes(): void {
    this.runtimes.clear();
    for (const c of this.config.collections) {
      const modes = c.modes ?? [];
      this.runtimes.set(c.name, {
        name: c.name,
        modes,
        defaultMode: modes[0] ?? 'default',
        ...(c.modeDimension !== undefined ? { modeDimension: c.modeDimension } : {}),
        ...(c.fileModes ? { fileModes: new Map(Object.entries(c.fileModes)) } : {}),
        ...(c.modeLabels ? { modeLabels: new Map(Object.entries(c.modeLabels)) } : {}),
      });
    }
  }

  // ---- Loading & resolution ----

  async load(): Promise<void> {
    this.files = await this.scanFiles();
    await this.reparse();
  }

  private async scanFiles(): Promise<Map<string, FileEntry>> {
    const out = new Map<string, FileEntry>();
    for (const c of this.config.collections) {
      const globs = Array.isArray(c.files) ? c.files : [c.files];
      const matches = await fg(globs, {
        cwd: this.root,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.tokenflow/**'],
      });
      for (const abs of matches) {
        if (out.has(abs)) continue; // first collection in config order wins
        const content = await readFile(abs, 'utf8');
        out.set(abs, {
          abs,
          rel: relative(this.root, abs),
          collection: c.name,
          content,
          hash: hashContent(content),
          readOnly: content.includes('<<<<<<<'),
        });
      }
    }
    return out;
  }

  /** Re-parse + re-resolve all currently loaded files. */
  private async reparse(): Promise<void> {
    const rawByCollection = new Map<string, RawToken[]>();
    const parseDiags: Diagnostic[] = [];

    for (const entry of this.files.values()) {
      const rt = this.runtimes.get(entry.collection)!;
      const fileMode = rt.fileModes?.get(entry.rel);
      const { tokens, diagnostics } = parseFile(entry.content, {
        file: entry.rel,
        collection: entry.collection,
        // Mode dimension (path) or file modes → parse flat; mode is applied later.
        modes: rt.modeDimension !== undefined || rt.fileModes ? [] : rt.modes,
        // For file-based modes, tag this file's values with its mode.
        defaultMode: fileMode ?? rt.defaultMode,
        strictTypes: this.config.strictTypes,
        inferTypes: this.config.inferTypes,
      });
      parseDiags.push(...diagnostics);
      const list = rawByCollection.get(entry.collection) ?? [];
      list.push(...tokens);
      rawByCollection.set(entry.collection, list);
    }

    const order = this.config.resolution.order ?? this.config.collections.map((c) => c.name);
    this.effectiveModes = new Map();
    this.modeDims = new Map();
    const inputs: CollectionInput[] = this.config.collections.map((c) => {
      const rt = this.runtimes.get(c.name)!;
      let tokens = rawByCollection.get(c.name) ?? [];
      let modes = rt.modes;
      let defaultMode = rt.defaultMode;

      if (rt.modeDimension !== undefined && rt.modes.length > 0) {
        // Configured path-segment mode dimension.
        const dim = { dimension: rt.modeDimension, modes: rt.modes };
        tokens = mergeByModeDimension(tokens, dim, rt.defaultMode);
        this.modeDims.set(c.name, dim);
      } else if (rt.fileModes && rt.modes.length > 0) {
        // File-based modes (one file per theme): merge same-path tokens.
        tokens = mergeByPath(tokens);
      } else if (rt.modes.length === 0) {
        // No declared modes → auto-detect a mode dimension (modeLight/modeDark…)
        // so themes surface as COLUMNS instead of staying in the path.
        const dim = detectModeDimension(tokens.map((t) => t.path));
        if (dim) {
          tokens = mergeByModeDimension(tokens, dim, dim.modes[0]!);
          modes = dim.modes;
          defaultMode = dim.modes[0]!;
          this.modeDims.set(c.name, dim);
        }
      }

      this.effectiveModes.set(c.name, modes);
      return { name: c.name, modes, defaultMode, tokens };
    });

    const { tokens, diagnostics: resolveDiags } = resolveProject(inputs, {
      order,
      crossCollection: this.config.resolution.crossCollection,
      maxAliasDepth: this.config.resolution.maxAliasDepth,
    });

    // Validate non-alias values per type.
    const validateDiags: Diagnostic[] = [];
    for (const t of tokens) {
      for (const [mode, raw] of Object.entries(t.rawValuesByMode)) {
        const msg = validateValue(raw, t.type);
        if (msg) {
          validateDiags.push(
            makeDiagnostic('invalid-token', 'error', msg, { tokenId: t.id, mode, file: t.source.file }),
          );
        }
      }
    }

    this.diagnostics = [...parseDiags, ...resolveDiags, ...validateDiags];
    this.tokensById = new Map(tokens.map((t) => [t.id, t]));
    this.collections = this.buildCollections(tokens);
    this.rebuildIndexes(tokens);
  }

  /**
   * Expand a logical node path into its physical on-disk path(s).
   *
   * On a mode-folded collection the mode segment was removed from the logical
   * path (modes surface as columns); re-insert it at the dimension index — once
   * per mode — so node-level mutations (reorder/move/rename) target the real
   * on-disk nodes. Returns `[logicalPath]` unchanged for flat / file-mode
   * collections, or when the path sits strictly above the mode dimension.
   */
  private physicalPaths(collection: string, logicalPath: string[]): string[][] {
    const dim = this.modeDims.get(collection);
    if (!dim || logicalPath.length < dim.dimension) return [logicalPath];
    return dim.modes.map((m) => [
      ...logicalPath.slice(0, dim.dimension),
      m,
      ...logicalPath.slice(dim.dimension),
    ]);
  }

  /**
   * The file entry a value edit for `mode` should target. For file-based modes
   * (one file per theme) the edit must land in the file mapped to that mode —
   * not the merged token's nominal `source.file`, which is just the first file.
   * Falls back to the token's own source file for every other strategy.
   */
  private fileEntryForMode(token: ParsedToken, mode: string): FileEntry | undefined {
    const rt = this.runtimes.get(token.collection);
    if (rt?.fileModes) {
      for (const [rel, m] of rt.fileModes) {
        if (m !== mode) continue;
        const e = this.files.get(join(this.root, rel));
        if (e) return e;
      }
    }
    return this.files.get(join(this.root, token.source.file));
  }

  /** Resolution rank of a collection (earlier = lower; only earlier are referenceable). */
  private rank(name: string): number {
    const order = this.config.resolution.order ?? this.config.collections.map((c) => c.name);
    const i = order.indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }

  /** Resolve an alias path from `fromCollection` to a concrete token id, mirroring resolver scoping. */
  private resolveTargetId(fromCollection: string, aliasPath: string[]): string | undefined {
    const direct = this.lookupByPath(fromCollection, aliasPath.join('.'));
    if (direct) return direct;
    // Collection-namespace alias (`{primitive.green.500}`): the first segment
    // names a collection, not a path. Retry against the token at the remaining
    // path inside that collection, falling back to the general scoped lookup.
    if (aliasPath.length > 1) {
      const ns = this.collectionNamespaces.get(aliasPath[0]!.toLowerCase());
      if (ns) {
        const rest = aliasPath.slice(1).join('.');
        const inNs = this.byPathKey.get(rest)?.find((e) => e.collection === ns);
        if (inNs) return inNs.id;
        const scoped = this.lookupByPath(fromCollection, rest);
        if (scoped) return scoped;
      }
    }
    return undefined;
  }

  /** Look up a path key as an alias target from `fromCollection` (self, then earlier collections by rank). */
  private lookupByPath(fromCollection: string, pk: string): string | undefined {
    const direct = this.byPathKey.get(pk)?.find((e) => e.collection === fromCollection);
    if (direct) return direct.id;
    if (!this.config.resolution.crossCollection) return undefined;
    const fromRank = this.rank(fromCollection);
    let best: { id: string; rank: number } | undefined;
    for (const e of this.byPathKey.get(pk) ?? []) {
      if (e.rank <= fromRank && (!best || e.rank > best.rank)) best = { id: e.id, rank: e.rank };
    }
    return best?.id;
  }

  /** Build the collection-namespace map (name + "/"-segments + singular/plural). */
  private buildCollectionNamespaces(tokens: ParsedToken[]): void {
    this.collectionNamespaces = new Map();
    for (const name of new Set(tokens.map((t) => t.collection))) {
      const n = name.toLowerCase();
      for (const base of new Set<string>([n, ...n.split('/')])) {
        const variant = base.endsWith('s') ? base.slice(0, -1) : `${base}s`;
        for (const v of [base, variant]) if (!this.collectionNamespaces.has(v)) this.collectionNamespaces.set(v, name);
      }
    }
  }

  /** Direct alias target paths declared by a token across all modes (top-level + composite). */
  private aliasTargetsOf(token: ParsedToken): string[][] {
    const out: string[][] = [];
    for (const raw of Object.values(token.rawValuesByMode)) {
      if (isAlias(raw)) {
        const p = parseAliasPath(raw);
        if (p) out.push(p);
      } else if (isCompositeType(token.type) && raw && typeof raw === 'object') {
        for (const v of Object.values(raw as Record<string, unknown>)) {
          if (isAlias(v)) {
            const p = parseAliasPath(v);
            if (p) out.push(p);
          }
        }
      }
    }
    return out;
  }

  private rebuildIndexes(tokens: ParsedToken[]): void {
    // pathKey -> entries
    this.byPathKey = new Map();
    for (const t of tokens) {
      const pk = t.path.join('.');
      const list = this.byPathKey.get(pk) ?? [];
      list.push({ id: t.id, collection: t.collection, rank: this.rank(t.collection) });
      this.byPathKey.set(pk, list);
    }
    this.buildCollectionNamespaces(tokens);

    // reference graph (which ids are referenced)
    this.referencedIds = new Set();
    for (const t of tokens) {
      for (const target of this.aliasTargetsOf(t)) {
        const id = this.resolveTargetId(t.collection, target);
        if (id) this.referencedIds.add(id);
      }
    }

    // full-text index
    const index = new MiniSearch<{
      id: string;
      name: string;
      leaf: string;
      description: string;
      type: string;
      collection: string;
      resolved: string;
    }>({
      fields: ['name', 'leaf', 'description', 'type', 'resolved'],
      storeFields: ['id'],
      searchOptions: { prefix: true, fuzzy: 0.2, boost: { leaf: 2, name: 1.5 } },
    });
    index.addAll(
      tokens.map((t) => ({
        id: t.id,
        name: t.path.join('.'),
        leaf: t.path[t.path.length - 1] ?? '',
        description: t.description ?? '',
        type: t.type,
        collection: t.collection,
        resolved: Object.values(t.resolvedValuesByMode)
          .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
          .join(' '),
      })),
    );
    this.searchIndex = index;
  }

  private buildCollections(tokens: ParsedToken[]): Map<string, Collection> {
    const out = new Map<string, Collection>();
    for (const c of this.config.collections) {
      const rt = this.runtimes.get(c.name)!;
      const colTokens = tokens.filter((t) => t.collection === c.name);
      // Prefer effective modes (declared OR auto-detected mode dimension).
      const effModes = this.effectiveModes.get(c.name) ?? rt.modes;
      const modeDefs: ModeDefinition[] = (effModes.length > 0 ? effModes : [rt.defaultMode]).map(
        (id) => {
          const label = rt.modeLabels?.get(id);
          return label ? { id, label } : { id };
        },
      );
      const files = [...new Set(colTokens.map((t) => t.source.file))];
      out.set(c.name, {
        id: c.name,
        name: c.name,
        files,
        modes: modeDefs,
        groups: buildGroupTree(colTokens),
        tokens: colTokens,
      });
    }
    return out;
  }

  // ---- Queries ----

  getState(): ProjectState {
    const summaries: CollectionSummary[] = [...this.collections.values()].map((c) => {
      const ids = new Set(c.tokens.map((t) => t.id));
      const diags = this.diagnostics.filter((d) => !d.tokenId || ids.has(d.tokenId));
      const dim = this.modeDims.get(c.id)?.dimension;
      return {
        id: c.id,
        name: c.name,
        files: c.files,
        modes: c.modes,
        ...(dim !== undefined ? { modeDimension: dim } : {}),
        tokenCount: c.tokens.length,
        errorCount: diags.filter((d) => d.severity === 'error').length,
        warningCount: diags.filter((d) => d.severity === 'warning').length,
      };
    });
    return {
      open: true,
      root: this.root,
      collections: summaries,
      diagnostics: this.diagnostics,
      tokenCount: this.tokensById.size,
      history: this.history.state(),
      setup: this.computeSetup(),
    };
  }

  /** Structural-setup status for the onboarding alert + guided setup panel. */
  private computeSetup(): ProjectSetup {
    const hasManifest = detectOrgManifest(this.root) !== null;
    const issues: SetupIssue[] = [...this.manifestIssues];
    if (this.organizationSource !== 'manifest') {
      issues.unshift({
        code: 'no-manifest',
        message:
          "Your project isn't configured yet. Define your collections and their modes (e.g. Light/Dark, Desktop/Tablet) so the tool understands your token structure.",
      });
    }
    // A collection that looks like it has path-segment modes but exposes only one
    // effective mode → the user likely can't see their modes; flag it.
    for (const [name, dim] of this.modeDims) {
      const eff = this.effectiveModes.get(name) ?? [];
      if (dim && eff.length <= 1) {
        issues.push({
          code: 'undetected-modes',
          collection: name,
          message: `Collection "${name}" appears to have modes that aren't configured.`,
        });
      }
    }
    return { organizationSource: this.organizationSource, hasManifest, issues };
  }

  getCollection(name: string): Collection | undefined {
    return this.collections.get(name);
  }

  getToken(id: string): ParsedToken | undefined {
    return this.tokensById.get(id);
  }

  /** Every token across all collections (used for cross-collection alias previews). */
  getAllTokens(): ParsedToken[] {
    return [...this.tokensById.values()];
  }

  getDiagnostics(): Diagnostic[] {
    return this.diagnostics;
  }

  getConfig(): TokenflowConfig {
    return this.config;
  }

  /** True once the user explicitly edits collections/modes — keeps them durable. */
  private collectionsLocked = false;

  /**
   * Update tool settings and/or collection mode definitions, re-resolve, and
   * persist `tokenflow.config.json`. Scalar settings always persist; editing
   * collections/order "locks" the collections (written as hand-authored so they
   * survive reload instead of being re-detected).
   */
  async updateSettings(patch: {
    strictTypes?: boolean;
    inferTypes?: boolean;
    writeDebounceMs?: number;
    crossCollection?: boolean;
    maxAliasDepth?: number;
    order?: string[];
    collections?: Array<{
      name: string;
      modes?: string[];
      fileModes?: Record<string, string>;
      modeDimension?: number | null;
    }>;
  }): Promise<TokenflowConfig> {
    const next: TokenflowConfig = {
      ...this.config,
      ...(patch.strictTypes !== undefined ? { strictTypes: patch.strictTypes } : {}),
      ...(patch.inferTypes !== undefined ? { inferTypes: patch.inferTypes } : {}),
      ...(patch.writeDebounceMs !== undefined ? { writeDebounceMs: patch.writeDebounceMs } : {}),
    };
    if (patch.crossCollection !== undefined || patch.maxAliasDepth !== undefined || patch.order) {
      next.resolution = {
        ...this.config.resolution,
        ...(patch.crossCollection !== undefined ? { crossCollection: patch.crossCollection } : {}),
        ...(patch.maxAliasDepth !== undefined ? { maxAliasDepth: patch.maxAliasDepth } : {}),
        ...(patch.order ? { order: patch.order } : {}),
      };
    }

    if (patch.collections) {
      // Snapshot the CURRENT effective collections (so detected modeDimension /
      // fileModes aren't lost), then apply the requested mode/fileMode overrides.
      const overrides = new Map(patch.collections.map((c) => [c.name, c]));
      next.collections = this.config.collections.map((c) => {
        const rt = this.runtimes.get(c.name);
        const eff = this.effectiveModes.get(c.name) ?? rt?.modes ?? [];
        // Effective path-segment mode dimension — may be configured (rt) OR
        // auto-detected (this.modeDims). Snapshotting `modes` without it would
        // stop the mode-folding on reparse and break in-collection aliases.
        const dim = rt?.modeDimension ?? this.modeDims.get(c.name)?.dimension;
        const o = overrides.get(c.name);
        const snapshot: typeof c = {
          ...c,
          ...(eff.length > 0 ? { modes: eff } : {}),
          ...(dim !== undefined ? { modeDimension: dim } : {}),
          ...(rt?.fileModes ? { fileModes: Object.fromEntries(rt.fileModes) } : {}),
        };
        if (!o) return snapshot;
        const merged = {
          ...snapshot,
          ...(o.modes ? { modes: o.modes } : {}),
          ...(o.fileModes ? { fileModes: o.fileModes } : {}),
        };
        if (o.modeDimension === null) {
          // Clear: revert to ordinary groups (no folding).
          delete merged.modeDimension;
          merged.modes = [];
        } else if (o.modeDimension !== undefined) {
          merged.modeDimension = o.modeDimension;
        }
        return merged;
      });
      this.collectionsLocked = true;
    }

    this.config = next;
    this.rebuildRuntimes();
    await this.reparse();
    await this.persistConfig();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
    return this.config;
  }

  private async persistConfig(): Promise<void> {
    const file = join(this.root, 'tokenflow.config.json');
    if (this.organizationSource === 'manifest') {
      // The manifest owns organization → tokenflow.config.json carries tool
      // PREFERENCES only (no collections, no resolution order).
      const out = {
        resolution: {
          crossCollection: this.config.resolution.crossCollection,
          maxAliasDepth: this.config.resolution.maxAliasDepth,
        },
        writeDebounceMs: this.config.writeDebounceMs,
        strictTypes: this.config.strictTypes,
        inferTypes: this.config.inferTypes,
      };
      await writeFileAtomic(file, JSON.stringify(out, null, 2) + '\n');
      await this.persistOrgManifest();
      return;
    }
    // Legacy / auto: organization lives in the config. Auto-generated persists only
    // settings (collections re-detect on load); locked configs are hand-authored.
    const out = { ...this.config, autoGenerated: !this.collectionsLocked };
    await writeFileAtomic(file, JSON.stringify(out, null, 2) + '\n');
  }

  /** Write the current organization to `manifest.json` (round-tripping unknown keys). */
  private async persistOrgManifest(): Promise<void> {
    const abs = join(this.root, ORG_MANIFEST_NAME);
    let raw: Record<string, unknown> = {};
    if (existsSync(abs)) {
      try {
        raw = await readOrgManifestRaw(abs);
      } catch {
        raw = {};
      }
    }
    const name = typeof raw['name'] === 'string' ? (raw['name'] as string) : 'Design Tokens';
    const obj = serializeOrgManifest(this.snapshotCollections(), name, raw);
    await this.backupArbitrary(abs);
    await writeFileAtomic(abs, serializeOrgManifestText(obj));
  }

  /** Open a file in the OS default application (e.g. the manifest in an editor). */
  async openInEditor(abs: string): Promise<boolean> {
    const run = promisify(execFile);
    try {
      if (process.platform === 'darwin') await run('open', [abs]);
      else if (process.platform === 'win32') await run('cmd', ['/c', 'start', '', abs]);
      else await run('xdg-open', [abs]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate `manifest.json` from the current organization (for a legacy/auto
   * project), switch the source of truth to it, and slim `tokenflow.config.json`
   * to preferences only. Recorded as one undoable structural command.
   */
  async generateOrgManifest(): Promise<MutationResult> {
    return this.runStructural('Generate manifest.json', async () => {
      this.organizationSource = 'manifest';
      this.collectionsLocked = true;
      this.manifestIssues = [];
      await this.persistConfig(); // writes settings-only config + the manifest
      this.emit('event', { type: 'project-reloaded' });
      this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
      return { ok: true, affectedTokenIds: [], diagnostics: [] };
    });
  }

  // ---- Distribution (Phase 4 — token-config.json companion) ----
  //
  // The configurator edits the project's `token-config.json` manifest (consumed
  // by a project-owned build script). JSON round-trips: the edited model is
  // merged back over the on-disk object so hand-tuned keys are preserved. The
  // wizard can also scaffold the build script + an npm script.

  private sdAvailable: boolean | null = null;
  private pkgRootCache: string | null = null;

  /**
   * The nearest ancestor directory holding a `package.json` (the real project
   * root). Users often open the *tokens* subfolder (e.g. `src/design-tokens`),
   * but the build command, npm scripts, `node_modules`, and root configs live at
   * the package root — distribution detection must look there, not at `this.root`.
   */
  private pkgRoot(): string {
    if (this.pkgRootCache !== null) return this.pkgRootCache;
    let dir = this.root;
    for (;;) {
      if (existsSync(join(dir, 'package.json'))) break;
      const parent = dirname(dir);
      if (parent === dir) {
        dir = this.root; // none found — fall back to the opened folder
        break;
      }
      dir = parent;
    }
    this.pkgRootCache = dir;
    return dir;
  }

  /** Whether `style-dictionary` resolves (the build script needs it). */
  private styleDictionaryAvailable(): boolean {
    if (this.sdAvailable !== null) return this.sdAvailable;
    try {
      createRequire(import.meta.url).resolve('style-dictionary');
      this.sdAvailable = true;
    } catch {
      // The user's own install is what actually runs the build.
      this.sdAvailable = existsSync(join(this.pkgRoot(), 'node_modules/style-dictionary/package.json'));
    }
    return this.sdAvailable;
  }

  /** Project collections shaped for the themes/source suggestions. */
  private distributionCollections(): DistributionCollection[] {
    return [...this.collections.values()].map((c) => ({
      name: c.name,
      files: c.files,
      modes: c.modes.map((m) => m.id),
    }));
  }

  /** Where a scaffolded build script lives (relative). */
  private readonly buildScriptRel = 'scripts/build-tokens-sd.js';

  /** Snapshot the Distribution UI renders from (parses the manifest if present). */
  async getDistribution(): Promise<DistributionState> {
    const collections = this.distributionCollections();
    const modes = [...new Set(collections.flatMap((c) => c.modes))];
    const pkgRoot = this.pkgRoot();
    const npmScripts = await readNpmScripts(pkgRoot);
    const styleDictionaryAvailable = this.styleDictionaryAvailable();
    const manifestPath = detectManifest(this.root);

    // A build script is "present" if our scaffold exists OR an npm script runs one.
    const buildScriptPath = existsSync(join(pkgRoot, this.buildScriptRel))
      ? this.buildScriptRel
      : null;
    const hasBuildScript = buildScriptPath !== null || npmScripts.some((s) => /node\s+\S+/.test(s.command));

    const v5ScriptPath = existsSync(join(pkgRoot, this.v5ScriptRel)) ? this.v5ScriptRel : null;
    const base = {
      projectId: this.root,
      collections,
      modes,
      npmScripts,
      styleDictionaryAvailable,
      sdVersion: detectSdVersion(pkgRoot),
      hasBuildScript,
      buildScriptPath,
      savedMatrix: this.readSavedMatrix(),
      savedConfig: this.readSavedConfig(),
      proposedConfig: this.proposeResolverConfig(),
      resolverConfigured: existsSync(join(pkgRoot, this.configSidecarRel)),
      v5ScriptPath,
      linked: this.readLinked(),
      detectedConfigs: this.detectConfigCandidates(),
    };

    if (!manifestPath) {
      return { manifestPath: null, exists: false, manifest: null, warnings: [], ...base };
    }

    const warnings: string[] = [];
    if (!styleDictionaryAvailable) {
      warnings.push('`style-dictionary` is not installed in this project — the build script will need it.');
    }
    try {
      const raw = await readManifestRaw(join(this.root, manifestPath));
      const manifest = toManifestModel(raw);
      return { manifestPath, exists: true, manifest, warnings, ...base };
    } catch (err) {
      warnings.push(`Could not parse "${manifestPath}": ${(err as Error).message}`);
      return { manifestPath, exists: true, manifest: null, warnings, ...base };
    }
  }

  /** Write the edited manifest back to disk (atomic + backup), preserving unknown keys. */
  async updateManifest(model: TokenConfigManifest): Promise<DistributionState> {
    const manifestPath = detectManifest(this.root) ?? MANIFEST_CANDIDATES[0]!;
    const abs = join(this.root, manifestPath);
    let raw: Record<string, unknown> = {};
    if (existsSync(abs)) {
      try {
        raw = await readManifestRaw(abs);
      } catch {
        raw = {};
      }
    }
    const content = serializeManifest(mergeManifestIntoRaw(raw, model));
    await this.backupArbitrary(abs);
    await writeFileAtomic(abs, content);
    return this.getDistribution();
  }

  /**
   * Scaffold the manifest when missing (from the project's collections), and —
   * when `scaffoldScript` — write the build script and add an npm script.
   */
  async initDistribution(scaffoldScript: boolean): Promise<DistributionState> {
    const manifestPath = detectManifest(this.root) ?? MANIFEST_CANDIDATES[0]!;
    const abs = join(this.root, manifestPath);
    if (!existsSync(abs)) {
      const model = defaultManifest(this.distributionCollections());
      await this.backupArbitrary(abs);
      await writeFileAtomic(abs, serializeManifest(mergeManifestIntoRaw({}, model)));
    }
    if (scaffoldScript) await this.scaffoldBuildScript();
    return this.getDistribution();
  }

  /**
   * Dry-run a Style Dictionary v5 matrix and return a concise report (errors,
   * warnings, produced files). Runs in a sandbox — the project is never written.
   */
  async testBuildDistribution(matrix: DistMatrix): Promise<DistBuildReport> {
    return runTestBuild(this.pkgRoot(), matrix, Date.now());
  }

  /** Where a generated v5 build script lives, and the matrix sidecar. */
  private readonly v5ScriptRel = 'scripts/tokens.build.mjs';
  private readonly distSidecarRel = '.tokenflow/distribution.json';
  /** Sidecar for the deterministic-resolver config (new path). */
  private readonly configSidecarRel = '.tokenflow/distribution.config.json';
  /** Sidecar pointing at an external build the project already owns. */
  private readonly linkSidecarRel = '.tokenflow/distribution-link.json';

  /** Common token-build config filenames to suggest when linking an existing setup. */
  private detectConfigCandidates(): string[] {
    const names = [
      'config.json',
      'sd.config.js',
      'sd.config.mjs',
      'sd.config.cjs',
      'sd.config.json',
      'style-dictionary.config.js',
      'style-dictionary.config.mjs',
      'style-dictionary.config.json',
      'tokens.config.js',
      'tokens.config.mjs',
      'tokens.config.json',
      'token-config.json',
    ];
    const root = this.pkgRoot();
    return names.filter((n) => existsSync(join(root, n)));
  }

  /** The previously-linked external config (sidecar), or null. */
  private readLinked(): LinkedConfig | null {
    const abs = join(this.pkgRoot(), this.linkSidecarRel);
    if (!existsSync(abs)) return null;
    try {
      const raw = JSON.parse(readFileSync(abs, 'utf8')) as Partial<LinkedConfig>;
      if (typeof raw.buildCommand !== 'string') return null;
      return { configPath: typeof raw.configPath === 'string' ? raw.configPath : '', buildCommand: raw.buildCommand };
    } catch {
      return null;
    }
  }

  /** Link an existing external build: persist the pointer sidecar. */
  async linkExisting(link: LinkedConfig): Promise<DistributionState> {
    const sidecar = join(this.pkgRoot(), this.linkSidecarRel);
    await mkdir(dirname(sidecar), { recursive: true });
    await writeFileAtomic(sidecar, JSON.stringify(link, null, 2) + '\n');
    return this.getDistribution();
  }

  /** Remove the external-build pointer (does not touch the project's own config). */
  async unlinkExisting(): Promise<DistributionState> {
    await rm(join(this.pkgRoot(), this.linkSidecarRel), { force: true });
    return this.getDistribution();
  }

  /**
   * Run the project's REAL build command (`cwd = root`). ⚠️ NOT sandboxed — this
   * executes the project's own build and WRITES its outputs to disk. The UI must
   * present this as "run the build" (not a dry-run).
   */
  async runProjectCommand(buildCommand: string): Promise<DistBuildReport> {
    return runExternalCommand(this.pkgRoot(), buildCommand, Date.now());
  }

  /** The previously-saved v5 matrix (sidecar), or null. */
  private readSavedMatrix(): unknown {
    const abs = join(this.pkgRoot(), this.distSidecarRel);
    if (!existsSync(abs)) return null;
    try {
      return JSON.parse(readFileSync(abs, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * The deterministic-resolver config to hydrate the wizard from: the new
   * sidecar if present, else a best-effort migration of the legacy matrix
   * sidecar, else null.
   */
  private readSavedConfig(): DistConfig | null {
    const abs = join(this.pkgRoot(), this.configSidecarRel);
    if (existsSync(abs)) {
      try {
        return DistConfigSchema.parse(JSON.parse(readFileSync(abs, 'utf8')));
      } catch {
        /* fall through to migration */
      }
    }
    const matrix = this.readSavedMatrix();
    return matrix ? matrixToConfig(matrix) : null;
  }

  /**
   * Auto-detect each collection's topology (nested path-segment modes vs. one
   * file per mode) and propose a deterministic-resolver config the wizard can
   * start from (mode → selector map editable in the UI).
   */
  private proposeResolverConfig(): DistConfig {
    const cols: ProposeCollection[] = this.config.collections.map((c) => {
      const col = this.collections.get(c.name);
      const rt = this.runtimes.get(c.name);
      const modes = (col?.modes ?? []).map((m) => m.id).filter((id) => id !== 'default');
      let topology: ProposeCollection['topology'] = 'none';
      let fileModes: Record<string, string> | undefined;
      if (rt?.fileModes && rt.fileModes.size > 0) {
        topology = 'files';
        fileModes = Object.fromEntries(rt.fileModes);
      } else if (rt?.modeDimension !== undefined && modes.length >= 2) {
        topology = 'nested';
      }
      return { id: c.name, files: col?.files ?? [], modes, topology, ...(fileModes ? { fileModes } : {}) };
    });
    // Collection files are relative to the project root; the generated script
    // resolves its ROOT to the package root, so point sourceRoot at the project.
    const sourceRoot = relative(this.pkgRoot(), this.root);
    const savedDest = this.readSavedConfig()?.outputs?.[0]?.destination;
    return proposeConfig(cols, { sourceRoot, destination: savedDest });
  }

  /** Dry-run the deterministic resolver (sandboxed; the project is never written). */
  async testBuildResolver(config: DistConfig): Promise<DistBuildReport> {
    return runResolverBuild(this.pkgRoot(), config, Date.now());
  }

  /**
   * Write the deterministic resolver build script (config embedded) + ensure an
   * npm script runs it, and persist the config to its sidecar. The script has no
   * runtime dependencies (no Style Dictionary), so nothing is added to
   * package.json beyond the npm script.
   */
  async writeResolver(config: DistConfig): Promise<WriteDistributionResult> {
    const root = this.pkgRoot();
    const scriptAbs = join(root, this.v5ScriptRel);
    await mkdir(dirname(scriptAbs), { recursive: true });
    await this.backupArbitrary(scriptAbs);
    await writeFileAtomic(scriptAbs, generateResolverScript(config));

    const sidecar = join(root, this.configSidecarRel);
    await mkdir(dirname(sidecar), { recursive: true });
    await writeFileAtomic(sidecar, JSON.stringify(config, null, 2) + '\n');

    const npmScript = { name: 'tokens:build', command: `node ${this.v5ScriptRel}` };
    const npmAdded = await this.ensureNpmScript(npmScript);
    return { ok: true, scriptPath: this.v5ScriptRel, npmScript, npmAdded, addedDependencies: [] };
  }

  /**
   * Write the v5 build script (matrix embedded) + ensure an npm script runs it,
   * and persist the matrix to a sidecar so reopening restores it. Does NOT run
   * the build — that stays the project's `npm run` (only test-build runs, sandboxed).
   */
  async writeDistribution(matrix: DistMatrix): Promise<WriteDistributionResult> {
    const root = this.pkgRoot();
    const scriptAbs = join(root, this.v5ScriptRel);
    await mkdir(dirname(scriptAbs), { recursive: true });
    await this.backupArbitrary(scriptAbs);
    await writeFileAtomic(scriptAbs, generateV5Script(matrix));

    // Persist the matrix (source of truth for reopening / regenerating).
    const sidecar = join(root, this.distSidecarRel);
    await mkdir(dirname(sidecar), { recursive: true });
    await writeFileAtomic(sidecar, JSON.stringify(matrix, null, 2) + '\n');

    const npmScript = { name: 'tokens:build', command: `node ${this.v5ScriptRel}` };
    const npmAdded = await this.ensureNpmScript(npmScript);
    // The generated script imports `style-dictionary` (+ sd-transforms when the
    // Tokens Studio preset is on); add them to devDependencies so `npm install`
    // then `npm run tokens:build` works without the user hunting for the deps.
    const addedDependencies = await this.ensureBuildDependencies(matrix);
    return { ok: true, scriptPath: this.v5ScriptRel, npmScript, npmAdded, addedDependencies };
  }

  /**
   * Ensure the generated v5 script's runtime deps are in package.json (added to
   * devDependencies if absent from any dependency field). Does NOT run install —
   * returns the `name@range` specs added so the UI can prompt `npm install`.
   */
  private async ensureBuildDependencies(matrix: DistMatrix): Promise<string[]> {
    const want: Record<string, string> = { 'style-dictionary': '^5.0.0' };
    if (matrix.tokensStudio) want['@tokens-studio/sd-transforms'] = '^1.0.0';

    const pkgPath = join(this.pkgRoot(), 'package.json');
    if (!existsSync(pkgPath)) return [];
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        [k: string]: unknown;
      };
      const has = (name: string): boolean =>
        !!(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name]);

      const added: string[] = [];
      const dev = { ...(pkg.devDependencies ?? {}) };
      for (const [name, range] of Object.entries(want)) {
        if (has(name)) continue;
        dev[name] = range;
        added.push(`${name}@${range}`);
      }
      if (added.length === 0) return [];

      // Keep devDependencies key-sorted (npm's own convention) for a clean diff.
      pkg.devDependencies = Object.fromEntries(Object.entries(dev).sort(([a], [b]) => a.localeCompare(b)));
      await this.backupArbitrary(pkgPath);
      await writeFileAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      return added;
    } catch {
      return [];
    }
  }

  /** Write the build script (if absent) and ensure an npm script runs it. */
  async scaffoldBuildScript(): Promise<DistributionState> {
    const scriptAbs = join(this.pkgRoot(), this.buildScriptRel);
    if (!existsSync(scriptAbs)) {
      await mkdir(dirname(scriptAbs), { recursive: true });
      await writeFileAtomic(scriptAbs, buildTokensScript());
    }
    await this.ensureNpmScript(npmScriptFor(this.buildScriptRel));
    return this.getDistribution();
  }

  /** Add an npm script to package.json if neither its name nor command exists. */
  private async ensureNpmScript(script: { name: string; command: string }): Promise<boolean> {
    const pkgPath = join(this.pkgRoot(), 'package.json');
    if (!existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
        [k: string]: unknown;
      };
      const scripts = pkg.scripts ?? {};
      if (scripts[script.name] || Object.values(scripts).includes(script.command)) return false;
      pkg.scripts = { ...scripts, [script.name]: script.command };
      await this.backupArbitrary(pkgPath);
      await writeFileAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  /** Best-effort backup of an arbitrary file before overwrite. */
  private async backupArbitrary(abs: string): Promise<void> {
    if (!existsSync(abs)) return;
    try {
      const dir = join(this.root, BACKUP_DIR);
      await mkdir(dir, { recursive: true });
      const content = await readFile(abs, 'utf8');
      const stamp = hashContent(content).slice(0, 8);
      const safe = relative(this.root, abs).split('\\').join('/').replace(/[/]/g, '__');
      await copyFile(abs, join(dir, `${safe}.${stamp}.bak`)).catch(() => {});
      await this.rotateBackups(dir);
    } catch {
      /* best-effort */
    }
  }

  // ---- Mode management (add / rename) ----
  //
  // Modes are stored one of three ways; we detect which and act accordingly:
  //   • file      — one file per mode (themeOne.json…). Add = copy a file;
  //                 rename = relabel in config (filenames untouched).
  //   • dimension — a path segment encodes the mode (modeLight/modeDark, …).
  //                 Add = clone the segment subtree; rename = rename the segment.
  //   • inline    — `$value: { light, dark }`. Add/rename act on the `$value` key.
  //   • none      — single (unnamed) mode. Add = convert to inline modes.
  // These are STRUCTURAL ops (they also rewrite config), so — like settings —
  // they clear the byte-undo history and are reversed via the inverse action.

  private modeInfo(collection: string): ModeInfo | undefined {
    const rt = this.runtimes.get(collection);
    if (!rt) return undefined;
    const defaultMode = rt.defaultMode;
    if (rt.fileModes && rt.fileModes.size > 0) {
      return { storage: 'file', modes: [...rt.fileModes.values()], defaultMode, fileModes: rt.fileModes };
    }
    const dim = this.modeDims.get(collection);
    if (dim) return { storage: 'dimension', modes: dim.modes, defaultMode, dimension: dim.dimension };
    const modes = this.effectiveModes.get(collection) ?? rt.modes;
    if (modes.length > 0) return { storage: 'inline', modes, defaultMode };
    return { storage: 'none', modes: [], defaultMode };
  }

  /**
   * Snapshot every collection's effective modes/dimension/fileModes into the
   * config (so detected folding isn't lost), apply `patch` to one collection,
   * and lock the config (hand-authored). Mirrors the snapshot logic in
   * `updateSettings`. When `fileModes` is patched, the collection's `files` are
   * realigned to exactly the mode files so the scan picks up adds/removes.
   */
  /**
   * Snapshot the CURRENT effective collections into config-shaped entries, baking
   * in detected modes / mode-dimension / file-modes so a structural rewrite never
   * loses auto-detected folding. Shared by `applyCollectionPatch` and the
   * collection-level add/rename/delete operations.
   */
  private snapshotCollections(): TokenflowConfig['collections'] {
    return this.config.collections.map((c) => {
      const rt = this.runtimes.get(c.name);
      const eff = this.effectiveModes.get(c.name) ?? rt?.modes ?? [];
      const dim = rt?.modeDimension ?? this.modeDims.get(c.name)?.dimension;
      return {
        ...c,
        ...(eff.length > 0 ? { modes: eff } : {}),
        ...(dim !== undefined ? { modeDimension: dim } : {}),
        ...(rt?.fileModes ? { fileModes: Object.fromEntries(rt.fileModes) } : {}),
      };
    });
  }

  private applyCollectionPatch(
    collection: string,
    patch: { modes?: string[]; fileModes?: Record<string, string>; modeDimension?: number | null },
  ): void {
    this.config = {
      ...this.config,
      collections: this.snapshotCollections().map((c) => {
        if (c.name !== collection) return c;
        const snapshot = c;
        const merged: typeof c = { ...snapshot };
        if (patch.modes) merged.modes = patch.modes;
        if (patch.fileModes) {
          merged.fileModes = patch.fileModes;
          merged.files = Object.keys(patch.fileModes);
        }
        if (patch.modeDimension === null) delete merged.modeDimension;
        else if (patch.modeDimension !== undefined) merged.modeDimension = patch.modeDimension;
        return merged;
      }),
    };
    this.collectionsLocked = true;
  }

  /** Read a file's content, or null when it does not exist. */
  private async readIfExists(abs: string): Promise<string | null> {
    try {
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Run a structural operation (modes/collections) as a single undoable command.
   * Snapshots the config + every token file before the op, runs it, then records
   * the byte-level diff (including created/deleted files) so undo/redo can restore
   * the exact prior state via a config-aware reload. On failure nothing is recorded.
   */
  private async runStructural(
    label: string,
    body: () => Promise<MutationResult>,
  ): Promise<MutationResult> {
    // Re-entrancy guard: a nested structural call just runs inline.
    if (this.structuralCapture) return body();

    const before = new Map<string, string | null>();
    const rels = new Set<string>([...this.structuralMetaRels(), ...[...this.files.values()].map((e) => e.rel)]);
    for (const rel of rels) before.set(rel, await this.readIfExists(join(this.root, rel)));
    this.structuralCapture = { before };

    let result: MutationResult;
    try {
      result = await body();
    } finally {
      this.structuralCapture = null; // stop capturing whatever happens
    }
    if (result.ok) await this.recordStructural(label, before);
    return result;
  }

  /** Meta files captured by structural commands (config + organization manifest). */
  private structuralMetaRels(): string[] {
    return [this.configRel, ORG_MANIFEST_NAME];
  }

  /** Diff the captured "before" snapshot against the current disk state and push a command. */
  private async recordStructural(label: string, before: Map<string, string | null>): Promise<void> {
    // Union of files that existed before and files that exist now (+ config + manifest).
    const rels = new Set<string>([
      ...this.structuralMetaRels(),
      ...before.keys(),
      ...[...this.files.values()].map((e) => e.rel),
    ]);
    const changes: FileChange[] = [];
    for (const rel of rels) {
      const b = before.has(rel) ? before.get(rel)! : null;
      const a = await this.readIfExists(join(this.root, rel));
      if (b !== a) changes.push({ rel, before: b, after: a });
    }
    if (changes.length === 0) return;
    this.history.record({ label, changes, structural: true });
  }

  /** Lock + persist a structural config change, then re-scan, reparse, broadcast. */
  private async finishStructural(
    collection: string,
    patch: { modes?: string[]; fileModes?: Record<string, string>; modeDimension?: number | null },
  ): Promise<void> {
    // When NOT recording a structural command, the fine-grained value-edit history
    // no longer applies cleanly after a structural change — drop it. Inside a
    // structural capture (the common path) the op is recorded as one undoable
    // command on top of the existing history instead.
    if (!this.structuralCapture) this.history.clear();
    this.applyCollectionPatch(collection, patch);
    this.rebuildRuntimes();
    // Re-scan + reparse with the PATCHED config (not reload(), which for a manifest
    // project would re-derive from the still-stale manifest on disk). Persist after,
    // so the written manifest reflects the reparsed effective modes.
    await this.load();
    this.restartWatching();
    await this.persistConfig();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
  }

  /**
   * Commit a collection-level config change (add/rename/delete): lock the config
   * as hand-authored, re-scan + reparse from disk, persist, and broadcast. Drops
   * the value-edit history (the collection set changed structurally).
   */
  private async commitCollectionsChange(
    collections: TokenflowConfig['collections'],
    order?: string[],
  ): Promise<void> {
    if (!this.structuralCapture) this.history.clear();
    this.config = {
      ...this.config,
      collections,
      ...(order ? { resolution: { ...this.config.resolution, order } } : {}),
    };
    this.collectionsLocked = true;
    this.rebuildRuntimes();
    // Re-scan + reparse with the new collection set (see finishStructural note).
    await this.load();
    this.restartWatching();
    await this.persistConfig();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
  }

  /**
   * Add a new, empty collection backed by a freshly-created `*.tokens.json` file.
   * The file lands beside the existing token files (or at the project root when
   * none are loaded yet) and is registered in the config as an exact-path glob.
   */
  async addCollection(name: string): Promise<MutationResult> {
    return this.runStructural(`Add collection "${name.trim()}"`, () => this.addCollectionImpl(name));
  }
  private async addCollectionImpl(name: string): Promise<MutationResult> {
    const trimmed = name.trim();
    if (!trimmed) return fail('invalid-token', 'A collection name is required');
    if (this.config.collections.some((c) => c.name === trimmed)) {
      return fail('duplicate-token', `Collection "${trimmed}" already exists`);
    }

    // Place the file next to an existing token file when possible, else at root.
    const existing = [...this.files.values()][0];
    const dir = existing ? dirname(existing.abs) : this.root;
    const base = trimmed.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'collection';
    let rel = relative(this.root, join(dir, `${base}.json`));
    for (let n = 2; existsSync(join(this.root, rel)) || this.files.has(join(this.root, rel)); n++) {
      rel = relative(this.root, join(dir, `${base}-${n}.json`));
    }
    await writeFileAtomic(join(this.root, rel), '{}\n');

    await this.commitCollectionsChange([
      ...this.snapshotCollections(),
      { name: trimmed, files: [rel] },
    ]);
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /** Rename a collection (config-level only — files keep their names). */
  async renameCollection(from: string, to: string): Promise<MutationResult> {
    return this.runStructural(`Rename collection "${from}" → "${to.trim()}"`, () =>
      this.renameCollectionImpl(from, to),
    );
  }
  private async renameCollectionImpl(from: string, to: string): Promise<MutationResult> {
    const target = to.trim();
    if (!target) return fail('invalid-token', 'A collection name is required');
    if (!this.config.collections.some((c) => c.name === from)) {
      return fail('invalid-token', `Unknown collection "${from}"`);
    }
    if (from === target) return { ok: true, affectedTokenIds: [], diagnostics: [] };
    if (this.config.collections.some((c) => c.name === target)) {
      return fail('duplicate-token', `Collection "${target}" already exists`);
    }
    const collections = this.snapshotCollections().map((c) =>
      c.name === from ? { ...c, name: target } : c,
    );
    const order = this.config.resolution.order?.map((n) => (n === from ? target : n));
    await this.commitCollectionsChange(collections, order);
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /**
   * Remove a collection from the config. Its files are left on disk (mirrors the
   * non-destructive mode-deletion behaviour); a project always keeps ≥1 collection.
   */
  async deleteCollection(name: string): Promise<MutationResult> {
    return this.runStructural(`Delete collection "${name}"`, () => this.deleteCollectionImpl(name));
  }
  private async deleteCollectionImpl(name: string): Promise<MutationResult> {
    if (!this.config.collections.some((c) => c.name === name)) {
      return fail('invalid-token', `Unknown collection "${name}"`);
    }
    if (this.config.collections.length <= 1) {
      return fail('invalid-token', 'A project needs at least one collection');
    }
    const collections = this.snapshotCollections().filter((c) => c.name !== name);
    const order = this.config.resolution.order?.filter((n) => n !== name);
    await this.commitCollectionsChange(collections, order);
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /** Write a batch of file edits atomically (rollback on error). */
  private async writeStaged(staged: Array<{ entry: FileEntry; content: string }>): Promise<void> {
    const originals = staged.map((s) => ({ entry: s.entry, content: s.entry.content }));
    try {
      for (const s of staged) {
        await this.backup(s.entry);
        await writeFileAtomic(s.entry.abs, s.content);
        s.entry.content = s.content;
        s.entry.hash = hashContent(s.content);
      }
    } catch (err) {
      for (const o of originals) {
        await writeFileAtomic(o.entry.abs, o.content).catch(() => {});
        o.entry.content = o.content;
        o.entry.hash = hashContent(o.content);
      }
      throw err;
    }
  }

  /** Add a new mode to a collection, seeded by copying an existing mode. */
  async addMode(collection: string, name: string, fromMode?: string): Promise<MutationResult> {
    return this.runStructural(`Add mode "${name.trim()}" to ${collection}`, () =>
      this.addModeImpl(collection, name, fromMode),
    );
  }
  private async addModeImpl(collection: string, name: string, fromMode?: string): Promise<MutationResult> {
    const info = this.modeInfo(collection);
    if (!info) return fail('invalid-token', `Unknown collection "${collection}"`);
    const newMode = name.trim();
    if (!newMode) return fail('invalid-token', `A mode name is required`);
    if (info.modes.includes(newMode)) {
      return fail('duplicate-token', `Mode "${newMode}" already exists in ${collection}`);
    }
    const src = fromMode && info.modes.includes(fromMode) ? fromMode : info.modes[0];

    if (info.storage === 'file') {
      return this.addFileMode(collection, info, newMode, src);
    }

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      let n = 0;
      if (info.storage === 'dimension') n = duplicateModeAtDimension(data, info.dimension!, src!, newMode);
      else if (info.storage === 'inline') n = duplicateInlineMode(data, src!, newMode);
      else n = wrapValuesAsInline(data, info.defaultMode, newMode); // none → inline
      if (n > 0) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    if (staged.length === 0) return fail('invalid-token', `No values found to seed mode "${newMode}"`);

    await this.writeStaged(staged);
    // 'none' becomes inline: the previously-unnamed mode gains its default name.
    const nextModes = info.storage === 'none' ? [info.defaultMode, newMode] : [...info.modes, newMode];
    await this.finishStructural(collection, { modes: nextModes });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /** File-based add: copy the source mode's file, register it as the new mode. */
  private async addFileMode(
    collection: string,
    info: ModeInfo,
    newMode: string,
    src: string | undefined,
  ): Promise<MutationResult> {
    let srcRel: string | undefined;
    for (const [rel, m] of info.fileModes!) if (m === src) { srcRel = rel; break; }
    srcRel ??= [...info.fileModes!.keys()][0];
    if (!srcRel) return fail('invalid-token', `No source file to copy for mode "${src}"`);
    const srcEntry = this.files.get(join(this.root, srcRel));
    if (!srcEntry) return fail('invalid-token', `Source file "${srcRel}" not loaded`);

    const base = newMode.replace(/[^a-zA-Z0-9._-]/g, '-');
    const newRel = join(dirname(srcRel), `${base}.json`);
    const newAbs = join(this.root, newRel);
    if (this.files.has(newAbs) || existsSync(newAbs)) {
      return fail('duplicate-token', `File "${newRel}" already exists`);
    }

    await writeFileAtomic(newAbs, srcEntry.content);
    const fileModes = { ...Object.fromEntries(info.fileModes!), [newRel]: newMode };
    await this.finishStructural(collection, { modes: [...info.modes, newMode], fileModes });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /** Rename a mode of a collection. */
  async renameMode(collection: string, from: string, to: string): Promise<MutationResult> {
    return this.runStructural(`Rename mode "${from}" → "${to.trim()}" in ${collection}`, () =>
      this.renameModeImpl(collection, from, to),
    );
  }
  private async renameModeImpl(collection: string, from: string, to: string): Promise<MutationResult> {
    const info = this.modeInfo(collection);
    if (!info) return fail('invalid-token', `Unknown collection "${collection}"`);
    const target = to.trim();
    if (!target) return fail('invalid-token', `A mode name is required`);
    if (!info.modes.includes(from)) return fail('invalid-token', `Mode "${from}" not found in ${collection}`);
    if (from === target) return { ok: true, affectedTokenIds: [], diagnostics: [] };
    if (info.modes.includes(target)) return fail('duplicate-token', `Mode "${target}" already exists`);
    const nextModes = info.modes.map((m) => (m === from ? target : m));

    if (info.storage === 'file') {
      // Relabel only — keep filenames (downstream build configs reference them).
      const fileModes: Record<string, string> = {};
      for (const [rel, m] of info.fileModes!) fileModes[rel] = m === from ? target : m;
      await this.finishStructural(collection, { modes: nextModes, fileModes });
      return { ok: true, affectedTokenIds: [], diagnostics: [] };
    }

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      const n =
        info.storage === 'dimension'
          ? renameModeAtDimension(data, info.dimension!, from, target)
          : renameInlineMode(data, from, target);
      if (n > 0) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    if (staged.length === 0) return fail('invalid-token', `Mode "${from}" not found in the files`);

    await this.writeStaged(staged);
    await this.finishStructural(collection, { modes: nextModes });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /** Remove a mode from a collection. The last remaining mode cannot be removed. */
  async deleteMode(collection: string, mode: string): Promise<MutationResult> {
    return this.runStructural(`Delete mode "${mode}" from ${collection}`, () =>
      this.deleteModeImpl(collection, mode),
    );
  }
  private async deleteModeImpl(collection: string, mode: string): Promise<MutationResult> {
    const info = this.modeInfo(collection);
    if (!info) return fail('invalid-token', `Unknown collection "${collection}"`);
    if (!info.modes.includes(mode)) return fail('invalid-token', `Mode "${mode}" not found in ${collection}`);
    if (info.modes.length <= 1) return fail('invalid-token', `Cannot remove the only mode of ${collection}`);
    const nextModes = info.modes.filter((m) => m !== mode);

    if (info.storage === 'file') {
      // Unregister the mode's file from the collection (its .json is left on disk).
      const fileModes: Record<string, string> = {};
      for (const [rel, m] of info.fileModes!) if (m !== mode) fileModes[rel] = m;
      await this.finishStructural(collection, { modes: nextModes, fileModes });
      return { ok: true, affectedTokenIds: [], diagnostics: [] };
    }

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      const n =
        info.storage === 'dimension'
          ? removeModeAtDimension(data, info.dimension!, mode)
          : removeInlineMode(data, mode);
      if (n > 0) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    if (staged.length === 0) return fail('invalid-token', `Mode "${mode}" not found in the files`);

    await this.writeStaged(staged);
    await this.finishStructural(collection, { modes: nextModes });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /** Duplicate a mode: a copy seeded from it, named with a free `<mode>2` suffix. */
  async duplicateMode(collection: string, mode: string): Promise<MutationResult> {
    return this.runStructural(`Duplicate mode "${mode}" in ${collection}`, () =>
      this.duplicateModeImpl(collection, mode),
    );
  }
  private async duplicateModeImpl(collection: string, mode: string): Promise<MutationResult> {
    const info = this.modeInfo(collection);
    if (!info) return fail('invalid-token', `Unknown collection "${collection}"`);
    if (!info.modes.includes(mode)) return fail('invalid-token', `Mode "${mode}" not found in ${collection}`);
    const taken = new Set(info.modes);
    let name = `${mode}2`;
    for (let i = 2; taken.has(name); i++) name = `${mode}${i}`;
    // addMode's own structural wrapper no-ops here (re-entrancy guard) — this op is
    // recorded as the single "Duplicate mode" command.
    return this.addMode(collection, name, mode);
  }

  // ---- Mutations ----

  /** Update a single token's value for a given mode and persist atomically. */
  async updateValue(id: string, mode: string, value: unknown): Promise<MutationResult> {
    const token = this.tokensById.get(id);
    if (!token) {
      return fail('invalid-token', `Token "${id}" not found`);
    }
    const entry = this.fileEntryForMode(token, mode);
    if (!entry) {
      return fail('invalid-token', `Source file for token not loaded`);
    }
    if (entry.readOnly) {
      return fail('merge-conflict', `File "${entry.rel}" is read-only (merge conflict)`);
    }

    const validationMsg = validateValue(value, token.type);
    if (validationMsg) {
      return fail('invalid-token', validationMsg, id, mode);
    }

    // Detect concurrent on-disk modification before writing.
    const onDisk = await readFile(entry.abs, 'utf8');
    if (hashContent(onDisk) !== entry.hash) {
      return fail('invalid-token', `File "${entry.rel}" changed on disk; reload before editing`);
    }

    const rt = this.runtimes.get(entry.collection)!;
    const format = detectFormat(entry.content);
    const data = parseDocument(entry.content);

    // Translate the logical path to the physical on-disk path when a mode
    // dimension folded a path segment into columns (re-insert the mode segment).
    const dim = this.modeDims.get(entry.collection);
    let ok: boolean;
    if (dim && token.path.length >= dim.dimension && dim.modes.includes(mode)) {
      const physicalPath = [
        ...token.path.slice(0, dim.dimension),
        mode,
        ...token.path.slice(dim.dimension),
      ];
      ok = setTokenValue(data, physicalPath, mode, value, { inlineMode: false });
    } else {
      const inlineMode = rt.modes.length > 0 && isInlineModeNode(data, token.path);
      ok = setTokenValue(data, token.path, mode, value, { inlineMode });
    }
    if (!ok) {
      return fail('invalid-token', `Could not locate token node at ${token.path.join('.')}`);
    }

    const next = stringifyDocument(data, format);
    const affected = await this.commitFile(entry, next, {
      label: `Edit ${token.path.join('.')}`,
      tokenId: id,
      coalesceKey: `v:${id}:${mode}`,
    });
    const updated = this.tokensById.get(id);
    return {
      ok: true,
      ...(updated ? { token: updated } : {}),
      affectedTokenIds: affected,
      diagnostics: updated?.diagnostics ?? [],
    };
  }

  /** Set (or clear) a token's `$description`, writing format-preserved. */
  async updateDescription(id: string, description: string): Promise<MutationResult> {
    const token = this.tokensById.get(id);
    if (!token) {
      return fail('invalid-token', `Token "${id}" not found`);
    }
    const entry = this.files.get(join(this.root, token.source.file));
    if (!entry) {
      return fail('invalid-token', `Source file for token not loaded`);
    }
    if (entry.readOnly) {
      return fail('merge-conflict', `File "${entry.rel}" is read-only (merge conflict)`);
    }

    // Detect concurrent on-disk modification before writing.
    const onDisk = await readFile(entry.abs, 'utf8');
    if (hashContent(onDisk) !== entry.hash) {
      return fail('invalid-token', `File "${entry.rel}" changed on disk; reload before editing`);
    }

    const format = detectFormat(entry.content);
    const data = parseDocument(entry.content);

    // The mode-dim fold splits one logical token across a physical node per
    // mode. Description is token-level, so write it to every mode node to keep
    // the file consistent (and clearing removes it everywhere).
    const dim = this.modeDims.get(entry.collection);
    let ok: boolean;
    if (dim && token.path.length >= dim.dimension) {
      ok = false;
      for (const m of dim.modes) {
        const physicalPath = [
          ...token.path.slice(0, dim.dimension),
          m,
          ...token.path.slice(dim.dimension),
        ];
        if (setTokenDescription(data, physicalPath, description)) ok = true;
      }
    } else {
      ok = setTokenDescription(data, token.path, description);
    }
    if (!ok) {
      return fail('invalid-token', `Could not locate token node at ${token.path.join('.')}`);
    }

    const next = stringifyDocument(data, format);
    const affected = await this.commitFile(entry, next, {
      label: `Describe ${token.path.join('.')}`,
      tokenId: id,
      coalesceKey: `d:${id}`,
    });
    const updated = this.tokensById.get(id);
    return {
      ok: true,
      ...(updated ? { token: updated } : {}),
      affectedTokenIds: affected,
      diagnostics: updated?.diagnostics ?? [],
    };
  }

  /**
   * Apply many value edits in a single transaction: one flush per file and a
   * single undo item (Phase 3.5.3). Validated up front — if any change is
   * invalid the whole batch is rejected (nothing written).
   */
  async updateValuesBatch(
    changes: Array<{ id: string; mode: string; value?: unknown }>,
  ): Promise<MutationResult> {
    if (changes.length === 0) return { ok: true, affectedTokenIds: [], diagnostics: [] };

    const perFile = new Map<string, { entry: FileEntry; data: JsonObject; format: ReturnType<typeof detectFormat> }>();
    for (const ch of changes) {
      const token = this.tokensById.get(ch.id);
      if (!token) return fail('invalid-token', `Token "${ch.id}" not found`, ch.id, ch.mode);
      const entry = this.fileEntryForMode(token, ch.mode);
      if (!entry) return fail('invalid-token', `Source file for token not loaded`, ch.id, ch.mode);
      if (entry.readOnly) {
        return fail('merge-conflict', `File "${entry.rel}" is read-only (merge conflict)`, ch.id, ch.mode);
      }
      const msg = validateValue(ch.value, token.type);
      if (msg) return fail('invalid-token', msg, ch.id, ch.mode);

      let pf = perFile.get(entry.abs);
      if (!pf) {
        const onDisk = await readFile(entry.abs, 'utf8');
        if (hashContent(onDisk) !== entry.hash) {
          return fail('invalid-token', `File "${entry.rel}" changed on disk; reload before editing`);
        }
        pf = { entry, data: parseDocument(entry.content), format: detectFormat(entry.content) };
        perFile.set(entry.abs, pf);
      }

      const rt = this.runtimes.get(entry.collection)!;
      const dim = this.modeDims.get(entry.collection);
      let ok: boolean;
      if (dim && token.path.length >= dim.dimension && dim.modes.includes(ch.mode)) {
        const physicalPath = [
          ...token.path.slice(0, dim.dimension),
          ch.mode,
          ...token.path.slice(dim.dimension),
        ];
        ok = setTokenValue(pf.data, physicalPath, ch.mode, ch.value, { inlineMode: false });
      } else {
        const inlineMode = rt.modes.length > 0 && isInlineModeNode(pf.data, token.path);
        ok = setTokenValue(pf.data, token.path, ch.mode, ch.value, { inlineMode });
      }
      if (!ok) return fail('invalid-token', `Could not locate token node at ${token.path.join('.')}`);
    }

    const staged = [...perFile.values()]
      .map((pf) => ({ entry: pf.entry, content: stringifyDocument(pf.data, pf.format) }))
      .filter((s) => s.content !== s.entry.content);
    if (staged.length === 0) return { ok: true, affectedTokenIds: [], diagnostics: [] };

    const before = this.snapshotResolved();
    const edits: FileChange[] = staged.map((s) => ({
      rel: s.entry.rel,
      before: s.entry.content,
      after: s.content,
    }));
    for (const s of staged) {
      await this.backup(s.entry);
      await writeFileAtomic(s.entry.abs, s.content);
      s.entry.content = s.content;
      s.entry.hash = hashContent(s.content);
    }
    this.recordHistory(edits, { label: `Set ${changes.length} value${changes.length > 1 ? 's' : ''}` });
    await this.reparse();

    const after = this.snapshotResolved();
    const affected: string[] = [];
    for (const [id, sig] of after) if (before.get(id) !== sig) affected.push(id);
    this.emit('event', { type: 'tokens-changed', affectedTokenIds: affected });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
    return { ok: true, affectedTokenIds: affected, diagnostics: [] };
  }

  /**
   * Create a new token (variable) at `req.path` with per-mode default values.
   * Writes match the collection's mode storage so the new row shows correctly in
   * every mode column (fixes the old inline-only heuristic that broke on
   * dimension/file-mode collections — cf. ISSUE #1):
   *  - `dimension` → one scalar node per mode at the physical (mode-segment) path;
   *  - `file`      → one scalar node per mode, in that mode's file;
   *  - `inline`    → a single node whose `$value` is a `{ mode: value }` object;
   *  - `none`      → a single scalar `$value`.
   */
  async createToken(req: CreateTokenRequest): Promise<MutationResult> {
    const col = this.collections.get(req.collection);
    if (!col) return fail('invalid-token', `Unknown collection "${req.collection}"`);
    const info = this.modeInfo(req.collection);
    if (!info) return fail('invalid-token', `Collection "${req.collection}" has no files`);

    const id = tokenId(req.collection, req.path);
    if (this.tokensById.has(id)) return fail('duplicate-token', `Token already exists`);

    const valueFor = (mode: string): unknown =>
      req.valuesByMode[mode] ?? req.valuesByMode[info.defaultMode] ?? Object.values(req.valuesByMode)[0];
    const makeNode = (value: unknown): Record<string, unknown> => {
      const node: Record<string, unknown> = { $type: req.type };
      if (req.description) node['$description'] = req.description;
      node['$value'] = value;
      return node;
    };

    const files = this.collectionFiles(req.collection);
    const staged: Array<{ entry: FileEntry; content: string }> = [];

    if (info.storage === 'file' && info.fileModes) {
      // One scalar node per mode, written into that mode's file.
      for (const [rel, mode] of info.fileModes) {
        const entry = this.files.get(join(this.root, rel));
        if (!entry || entry.readOnly) continue;
        const data = parseDocument(entry.content);
        setTokenNode(data, req.path, makeNode(valueFor(mode)));
        staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
      }
    } else {
      // dimension / inline / none all write into the collection's first file.
      const entry = files[0];
      if (!entry) return fail('invalid-token', `Collection "${req.collection}" has no writable file`);
      const data = parseDocument(entry.content);
      if (info.storage === 'dimension' && info.dimension !== undefined) {
        const phys = this.physicalPaths(req.collection, req.path);
        const modes = this.modeDims.get(req.collection)?.modes ?? info.modes;
        phys.forEach((p, i) => setTokenNode(data, p, makeNode(valueFor(modes[i] ?? info.defaultMode))));
      } else if (info.storage === 'inline') {
        const valuesByMode: Record<string, unknown> = {};
        for (const mode of info.modes) valuesByMode[mode] = valueFor(mode);
        setTokenNode(data, req.path, makeNode(valuesByMode));
      } else {
        setTokenNode(data, req.path, makeNode(valueFor(info.defaultMode)));
      }
      staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }

    const res = await this.commitStaged(staged, {
      label: `Create ${req.path.join('.')}`,
      tokenId: id,
    });
    if (!res.ok) return res;
    const created = this.tokensById.get(id);
    return {
      ok: true,
      ...(created ? { token: created } : {}),
      affectedTokenIds: [],
      diagnostics: created?.diagnostics ?? [],
    };
  }

  async deleteToken(id: string): Promise<MutationResult> {
    const token = this.tokensById.get(id);
    if (!token) return fail('invalid-token', `Token "${id}" not found`);

    // Mode-aware: remove every physical node — across each mode's file (file
    // storage) and each mode segment in the path (dimension storage), not just
    // the token's nominal first source file/logical path (cf. ISSUE #1).
    const phys = this.physicalPaths(token.collection, token.path);
    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(token.collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      let changed = false;
      for (const p of phys) if (deleteTokenNode(data, p)) changed = true;
      if (changed) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    if (staged.length === 0) return fail('invalid-token', `Could not locate token node`);
    return this.commitStaged(staged, { label: `Delete ${token.path.join('.')}`, tokenId: id });
  }

  // ---- References & search ----

  /** Tokens that directly alias the token `id`. */
  getReferences(id: string): ReferenceInfo[] {
    const target = this.tokensById.get(id);
    if (!target) return [];
    const out: ReferenceInfo[] = [];
    for (const t of this.tokensById.values()) {
      if (t.id === id) continue;
      const modes = new Set<string>();
      for (const [mode, raw] of Object.entries(t.rawValuesByMode)) {
        for (const p of this.aliasTargetsForValue(raw, t.type)) {
          if (this.resolveTargetId(t.collection, p) === id) modes.add(mode);
        }
      }
      if (modes.size > 0) {
        out.push({ id: t.id, path: t.path, collection: t.collection, type: t.type, modes: [...modes] });
      }
    }
    return out;
  }

  private aliasTargetsForValue(raw: unknown, type: ParsedToken['type']): string[][] {
    const out: string[][] = [];
    if (isAlias(raw)) {
      const p = parseAliasPath(raw);
      if (p) out.push(p);
    } else if (isCompositeType(type) && raw && typeof raw === 'object') {
      // Composite sub-properties may alias — including gradient stops, which are
      // an array of objects. Recurse one level into objects and arrays.
      const visit = (v: unknown): void => {
        if (isAlias(v)) {
          const p = parseAliasPath(v);
          if (p) out.push(p);
        } else if (v && typeof v === 'object') {
          for (const inner of Object.values(v as Record<string, unknown>)) visit(inner);
        }
      };
      visit(raw);
    }
    return out;
  }

  search(query: string, filters: SearchFilters = {}): SearchResponse {
    let ids: string[];
    if (query.trim() && this.searchIndex) {
      ids = this.searchIndex.search(query).map((r) => r.id as string);
    } else {
      ids = [...this.tokensById.keys()];
    }
    const hits: SearchHit[] = [];
    for (const id of ids) {
      const t = this.tokensById.get(id);
      if (!t) continue;
      if (filters.types && filters.types.length && !(filters.types as string[]).includes(t.type))
        continue;
      if (filters.collection && t.collection !== filters.collection) continue;
      if (filters.alias === 'only' && !t.isAlias) continue;
      if (filters.alias === 'none' && t.isAlias) continue;
      if (filters.deprecated && !t.deprecated) continue;
      if (filters.hasErrors && !t.diagnostics.some((d) => d.severity === 'error')) continue;
      if (filters.orphans && this.referencedIds.has(t.id)) continue;
      hits.push({ id: t.id, path: t.path, collection: t.collection, type: t.type });
    }
    return { hits: hits.slice(0, 200), total: hits.length };
  }

  // ---- Rename (safe, with reference propagation) ----

  /** Preview the impact of renaming token `id` to `newPath` without writing. */
  renamePreview(id: string, newPath: string[]): RenamePreview {
    const token = this.tokensById.get(id);
    if (!token) return { files: 0, references: 0, conflict: false };
    const conflict = this.tokensById.has(tokenId(token.collection, newPath));
    const fromRank = this.rank(token.collection);
    let files = 0;
    let references = 0;
    for (const entry of this.files.values()) {
      if (this.rank(entry.collection) < fromRank) continue;
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      const refs = countAliasReferences(data, token.path);
      const isOwner = entry.abs === join(this.root, token.source.file);
      if (refs > 0 || isOwner) files++;
      references += refs;
    }
    return { files, references, conflict };
  }

  /**
   * Rename a token and rewrite every incoming alias reference, across all files,
   * atomically (all files written, or none — originals restored on error).
   */
  async renameToken(id: string, newPath: string[], updateReferences = true): Promise<MutationResult> {
    const token = this.tokensById.get(id);
    if (!token) return fail('invalid-token', `Token "${id}" not found`);
    if (this.tokensById.has(tokenId(token.collection, newPath))) {
      return fail('duplicate-token', `A token already exists at ${newPath.join('.')}`);
    }
    const ownerAbs = join(this.root, token.source.file);
    const fromRank = this.rank(token.collection);

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.files.values()) {
      if (entry.readOnly) continue;
      const isOwner = entry.abs === ownerAbs;
      const canReference = this.rank(entry.collection) >= fromRank;
      if (!isOwner && !(updateReferences && canReference)) continue;

      const format = detectFormat(entry.content);
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      let touched = false;
      if (isOwner) {
        // Translate logical → physical: on a mode-folded collection the node
        // lives once per mode (re-inserted mode segment); move each variant.
        const oldPaths = this.physicalPaths(token.collection, token.path);
        const newPaths = this.physicalPaths(token.collection, newPath);
        let moved = false;
        for (let i = 0; i < oldPaths.length; i++) {
          if (renameNode(data, oldPaths[i]!, newPaths[i]!)) moved = true;
        }
        if (!moved) {
          return fail('invalid-token', `Could not move token node`);
        }
        touched = true;
      }
      if (updateReferences && canReference) {
        const n = rewriteAliasReferences(data, token.path, newPath);
        touched = touched || n > 0;
      }
      if (touched) staged.push({ entry, content: stringifyDocument(data, format) });
    }

    if (staged.length === 0) return fail('invalid-token', `Nothing to rename`);

    const originals = staged.map((s) => ({ entry: s.entry, content: s.entry.content }));
    const before = this.snapshotResolved();
    try {
      for (const s of staged) {
        await this.backup(s.entry);
        await writeFileAtomic(s.entry.abs, s.content);
        s.entry.content = s.content;
        s.entry.hash = hashContent(s.content);
      }
    } catch (err) {
      for (const o of originals) {
        await writeFileAtomic(o.entry.abs, o.content).catch(() => {});
        o.entry.content = o.content;
        o.entry.hash = hashContent(o.content);
      }
      await this.reparse();
      return fail('invalid-token', `Rename failed and was rolled back: ${String(err)}`);
    }

    this.recordHistory(
      staged.map((s, i) => ({ rel: s.entry.rel, before: originals[i]!.content, after: s.content })),
      { label: `Rename ${token.path.join('.')} → ${newPath.join('.')}`, tokenId: tokenId(token.collection, newPath) },
    );

    await this.reparse();
    const after = this.snapshotResolved();
    const affected: string[] = [];
    for (const [tid, sig] of after) if (before.get(tid) !== sig) affected.push(tid);
    this.emit('event', { type: 'tokens-changed', affectedTokenIds: affected });
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });

    const renamed = this.tokensById.get(tokenId(token.collection, newPath));
    return {
      ok: true,
      ...(renamed ? { token: renamed } : {}),
      affectedTokenIds: affected,
      diagnostics: renamed?.diagnostics ?? [],
    };
  }

  /**
   * Reorder the direct children of a group. Applied to every collection file
   * that contains the group (keeps multi-file/theme collections consistent).
   */
  async reorderTokens(
    collection: string,
    groupPath: string[],
    order: string[],
  ): Promise<MutationResult> {
    const col = this.collections.get(collection);
    if (!col) return fail('invalid-token', `Unknown collection "${collection}"`);

    const changed: Array<{ entry: FileEntry; content: string }> = [];
    let anyReorder = false;
    for (const rel of col.files) {
      const entry = this.files.get(join(this.root, rel));
      if (!entry || entry.readOnly) continue;
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      let didReorder = false;
      for (const phys of this.physicalPaths(collection, groupPath)) {
        if (reorderChildren(data, phys, order)) didReorder = true;
      }
      if (didReorder) {
        anyReorder = true;
        // Numeric (integer-canonical) keys always serialise in ascending order:
        // the in-memory reorder produces byte-identical JSON → not a real change.
        const next = stringifyDocument(data, detectFormat(entry.content));
        if (next !== entry.content) changed.push({ entry, content: next });
      }
    }
    if (changed.length === 0) {
      return fail(
        'invalid-token',
        anyReorder
          ? `Reorder had no effect — numeric keys (e.g. "50", "900") keep JSON's ascending order and can't be reordered.`
          : `Group not found or unchanged`,
      );
    }

    const edits = changed.map((c) => ({ rel: c.entry.rel, before: c.entry.content, after: c.content }));
    for (const c of changed) {
      await this.backup(c.entry);
      await writeFileAtomic(c.entry.abs, c.content);
      c.entry.content = c.content;
      c.entry.hash = hashContent(c.content);
    }
    this.recordHistory(edits, { label: `Reorder ${groupPath.join('.') || collection}` });
    await this.reparse();
    this.emit('event', { type: 'project-reloaded' });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /**
   * Re-nest a whole group: move the group (and its entire subtree) under a new
   * parent path. Every token under the group is rename-moved, atomically, with
   * incoming references rewritten.
   */
  async moveGroup(
    collection: string,
    groupPath: string[],
    newParentPath: string[],
  ): Promise<MutationResult> {
    const col = this.collections.get(collection);
    if (!col) return fail('invalid-token', `Unknown collection "${collection}"`);
    if (groupPath.length === 0) return fail('invalid-token', `Cannot move the root`);

    const groupName = groupPath[groupPath.length - 1]!;
    const newGroupPath = [...newParentPath, groupName];

    if (startsWithPath(newParentPath, groupPath)) {
      return fail('invalid-token', `Cannot move a group into itself`);
    }
    if (newGroupPath.join(' ') === groupPath.join(' ')) {
      return fail('invalid-token', `Group is already there`);
    }

    const tokens = col.tokens.filter((t) => startsWithPath(t.path, groupPath));
    if (tokens.length === 0) return fail('invalid-token', `Group has no tokens`);

    const renames = tokens.map((t) => ({
      old: t.path,
      new: [...newGroupPath, ...t.path.slice(groupPath.length)],
    }));
    const movingKeys = new Set(tokens.map((t) => t.path.join(' ')));
    for (const r of renames) {
      const existing = this.tokensById.get(tokenId(collection, r.new));
      if (existing && !movingKeys.has(r.new.join(' '))) {
        return fail('duplicate-token', `Target path ${r.new.join('.')} already exists`);
      }
    }

    return this.applyRenamesAtomic(collection, renames, {
      label: `Move group ${groupPath.join('.')} → ${newGroupPath.join('.')}`,
    });
  }

  /**
   * Move many tokens to new paths in one transaction → a **single** history item
   * (multi-selection cross-group drag, cut/paste of N variables). All tokens must
   * belong to the same collection. Callers are expected to pre-dedupe leaf names;
   * collisions with non-moving tokens — or two moves targeting the same path — are
   * rejected up front so nothing is written.
   */
  async moveTokensBatch(moves: Array<{ id: string; newPath: string[] }>): Promise<MutationResult> {
    if (moves.length === 0) return fail('invalid-token', `No tokens to move`);

    const renames: Array<{ old: string[]; new: string[] }> = [];
    const movingKeys = new Set<string>();
    let collection: string | undefined;
    let firstOld: string[] | undefined;
    for (const m of moves) {
      const token = this.tokensById.get(m.id);
      if (!token) return fail('invalid-token', `Token "${m.id}" not found`);
      if (collection === undefined) {
        collection = token.collection;
        firstOld = token.path;
      } else if (token.collection !== collection) {
        return fail('invalid-token', `All tokens must belong to the same collection`);
      }
      renames.push({ old: token.path, new: m.newPath });
      movingKeys.add(token.path.join(' '));
    }

    const targets = new Set<string>();
    for (const r of renames) {
      const key = r.new.join(' ');
      if (targets.has(key)) return fail('duplicate-token', `Two tokens target ${r.new.join('.')}`);
      targets.add(key);
      const existing = this.tokensById.get(tokenId(collection!, r.new));
      if (existing && !movingKeys.has(key)) {
        return fail('duplicate-token', `A token already exists at ${r.new.join('.')}`);
      }
    }

    const label =
      moves.length === 1
        ? `Move ${firstOld!.join('.')} → ${renames[0]!.new.join('.')}`
        : `Move ${moves.length} variables`;
    return this.applyRenamesAtomic(collection!, renames, {
      label,
      ...(moves.length === 1 ? { tokenId: tokenId(collection!, renames[0]!.new) } : {}),
    });
  }

  /**
   * Apply many path renames across all files atomically (move nodes + rewrite
   * refs). Node moves are translated logical → physical for the moving
   * `collection` (mode segment re-inserted per mode); reference rewrites stay
   * logical (aliases reference the mode-less path).
   */
  private async applyRenamesAtomic(
    collection: string,
    renames: Array<{ old: string[]; new: string[] }>,
    meta?: HistoryMeta,
  ): Promise<MutationResult> {
    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.files.values()) {
      if (entry.readOnly) continue;
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      let touched = false;
      for (const r of renames) {
        const oldPaths = this.physicalPaths(collection, r.old);
        const newPaths = this.physicalPaths(collection, r.new);
        for (let i = 0; i < oldPaths.length; i++) {
          if (renameNode(data, oldPaths[i]!, newPaths[i]!)) touched = true; // node lives here
        }
        if (rewriteAliasReferences(data, r.old, r.new) > 0) touched = true; // refs here
      }
      if (touched) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    if (staged.length === 0) return fail('invalid-token', `Nothing to move`);

    const originals = staged.map((s) => ({ entry: s.entry, content: s.entry.content }));
    try {
      for (const s of staged) {
        await this.backup(s.entry);
        await writeFileAtomic(s.entry.abs, s.content);
        s.entry.content = s.content;
        s.entry.hash = hashContent(s.content);
      }
    } catch (err) {
      for (const o of originals) {
        await writeFileAtomic(o.entry.abs, o.content).catch(() => {});
        o.entry.content = o.content;
        o.entry.hash = hashContent(o.content);
      }
      await this.reparse();
      return fail('invalid-token', `Move failed and was rolled back: ${String(err)}`);
    }

    if (meta) {
      this.recordHistory(
        staged.map((s, i) => ({ rel: s.entry.rel, before: originals[i]!.content, after: s.content })),
        meta,
      );
    }

    await this.reparse();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  // ---- Structural ops: rename group, delete group, duplicate ----

  /** Names already used directly under `parentPath` (token leaves + subgroups). */
  private childNames(collection: string, parentPath: string[]): Set<string> {
    const col = this.collections.get(collection);
    const out = new Set<string>();
    if (!col) return out;
    for (const t of col.tokens) {
      if (t.path.length > parentPath.length && parentPath.every((s, i) => t.path[i] === s)) {
        out.add(t.path[parentPath.length]!);
      }
    }
    return out;
  }

  /** First non-colliding name: `base`, then `base2`, `base3`, … */
  private nextFreeName(taken: Set<string>, base: string): string {
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const cand = `${base}${i}`;
      if (!taken.has(cand)) return cand;
    }
  }

  /** Backup + write a set of staged file edits atomically (rollback on error). */
  private async commitStaged(
    staged: Array<{ entry: FileEntry; content: string }>,
    meta?: HistoryMeta,
  ): Promise<MutationResult> {
    if (staged.length === 0) return fail('invalid-token', `Nothing changed`);
    const originals = staged.map((s) => ({ entry: s.entry, content: s.entry.content }));
    try {
      for (const s of staged) {
        await this.backup(s.entry);
        await writeFileAtomic(s.entry.abs, s.content);
        s.entry.content = s.content;
        s.entry.hash = hashContent(s.content);
      }
    } catch (err) {
      for (const o of originals) {
        await writeFileAtomic(o.entry.abs, o.content).catch(() => {});
        o.entry.content = o.content;
        o.entry.hash = hashContent(o.content);
      }
      await this.reparse();
      return fail('invalid-token', `Operation failed and was rolled back: ${String(err)}`);
    }
    if (meta) {
      this.recordHistory(
        staged.map((s, i) => ({ rel: s.entry.rel, before: originals[i]!.content, after: s.content })),
        meta,
      );
    }
    await this.reparse();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
    return { ok: true, affectedTokenIds: [], diagnostics: [] };
  }

  /**
   * Files of `collection` that are loaded and writable. Derived from the loaded
   * file set (not `col.files`), because for file-based-mode collections the merged
   * tokens report a single source file — so `col.files` would list only one theme
   * and structural ops (copy/duplicate/delete) would miss the other theme files.
   */
  private collectionFiles(collection: string): FileEntry[] {
    return [...this.files.values()].filter((e) => e.collection === collection && !e.readOnly);
  }

  /** Rename a group in place (change its last path segment), refs rewritten. */
  async renameGroup(collection: string, groupPath: string[], newName: string): Promise<MutationResult> {
    const col = this.collections.get(collection);
    if (!col) return fail('invalid-token', `Unknown collection "${collection}"`);
    if (groupPath.length === 0) return fail('invalid-token', `Cannot rename the root`);
    const clean = newName.trim();
    if (!clean) return fail('invalid-token', `Name cannot be empty`);
    const parent = groupPath.slice(0, -1);
    if (clean === groupPath[groupPath.length - 1]) {
      return { ok: true, affectedTokenIds: [], diagnostics: [] };
    }
    if (this.childNames(collection, parent).has(clean)) {
      return fail('duplicate-token', `"${clean}" already exists here`);
    }
    const newGroupPath = [...parent, clean];
    const tokens = col.tokens.filter((t) => startsWithPath(t.path, groupPath));
    if (tokens.length === 0) return fail('invalid-token', `Group has no tokens`);
    const renames = tokens.map((t) => ({
      old: t.path,
      new: [...newGroupPath, ...t.path.slice(groupPath.length)],
    }));
    return this.applyRenamesAtomic(collection, renames, {
      label: `Rename group ${groupPath.join('.')} → ${clean}`,
    });
  }

  /** Delete an entire group (its whole subtree) across all collection files. */
  async deleteGroup(collection: string, groupPath: string[]): Promise<MutationResult> {
    const col = this.collections.get(collection);
    if (!col) return fail('invalid-token', `Unknown collection "${collection}"`);
    if (groupPath.length === 0) return fail('invalid-token', `Cannot delete the root`);
    if (col.tokens.filter((t) => startsWithPath(t.path, groupPath)).length === 0) {
      return fail('invalid-token', `Group has no tokens`);
    }
    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      let changed = false;
      for (const phys of this.physicalPaths(collection, groupPath)) {
        if (deleteTokenNode(data, phys)) changed = true;
      }
      if (changed) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    return this.commitStaged(staged, { label: `Delete group ${groupPath.join('.')}` });
  }

  /** Duplicate a single token next to itself with a `name2`-style free name. */
  async duplicateToken(id: string): Promise<MutationResult> {
    const token = this.tokensById.get(id);
    if (!token) return fail('invalid-token', `Token "${id}" not found`);
    const parent = token.path.slice(0, -1);
    const leaf = token.path[token.path.length - 1]!;
    const newLeaf = this.nextFreeName(this.childNames(token.collection, parent), leaf);
    const newPath = [...parent, newLeaf];

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(token.collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      const oldPaths = this.physicalPaths(token.collection, token.path);
      const newPaths = this.physicalPaths(token.collection, newPath);
      let changed = false;
      for (let i = 0; i < oldPaths.length; i++) {
        const node = getTokenNode(data, oldPaths[i]!);
        if (node) {
          setTokenNode(data, newPaths[i]!, structuredClone(node) as JsonObject);
          changed = true;
        }
      }
      if (changed) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    const res = await this.commitStaged(staged, {
      label: `Duplicate ${token.path.join('.')}`,
      tokenId: tokenId(token.collection, newPath),
    });
    if (res.ok) {
      const nt = this.tokensById.get(tokenId(token.collection, newPath));
      if (nt) res.token = nt;
    }
    return res;
  }

  /**
   * Copy a token under a (possibly different) parent group within the SAME
   * collection — the "paste a variable here" gesture. Like `duplicateToken` but
   * the target parent is explicit; the leaf is de-duplicated under the target.
   * Per-mode / per-file nodes are copied (physical-path aware).
   */
  async copyTokenTo(id: string, targetParentPath: string[]): Promise<MutationResult> {
    const token = this.tokensById.get(id);
    if (!token) return fail('invalid-token', `Token "${id}" not found`);
    const newLeaf = this.nextFreeName(
      this.childNames(token.collection, targetParentPath),
      token.path[token.path.length - 1]!,
    );
    const newPath = [...targetParentPath, newLeaf];

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(token.collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      const oldPaths = this.physicalPaths(token.collection, token.path);
      const newPaths = this.physicalPaths(token.collection, newPath);
      let changed = false;
      for (let i = 0; i < oldPaths.length; i++) {
        const node = getTokenNode(data, oldPaths[i]!);
        if (node) {
          setTokenNode(data, newPaths[i]!, structuredClone(node) as JsonObject);
          changed = true;
        }
      }
      if (changed) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    const res = await this.commitStaged(staged, {
      label: `Paste ${newLeaf}`,
      tokenId: tokenId(token.collection, newPath),
    });
    if (res.ok) {
      const nt = this.tokensById.get(tokenId(token.collection, newPath));
      if (nt) res.token = nt;
    }
    return res;
  }

  /** Duplicate a whole group (subtree, incl. group metadata) as a free-named sibling. */
  async duplicateGroup(collection: string, groupPath: string[]): Promise<MutationResult> {
    const col = this.collections.get(collection);
    if (!col) return fail('invalid-token', `Unknown collection "${collection}"`);
    if (groupPath.length === 0) return fail('invalid-token', `Cannot duplicate the root`);
    if (col.tokens.filter((t) => startsWithPath(t.path, groupPath)).length === 0) {
      return fail('invalid-token', `Group has no tokens`);
    }
    const parent = groupPath.slice(0, -1);
    const newName = this.nextFreeName(this.childNames(collection, parent), groupPath[groupPath.length - 1]!);
    const newGroupPath = [...parent, newName];

    const staged: Array<{ entry: FileEntry; content: string }> = [];
    for (const entry of this.collectionFiles(collection)) {
      let data: JsonObject;
      try {
        data = parseDocument(entry.content);
      } catch {
        continue;
      }
      const oldPaths = this.physicalPaths(collection, groupPath);
      const newPaths = this.physicalPaths(collection, newGroupPath);
      let changed = false;
      for (let i = 0; i < oldPaths.length; i++) {
        const node = getGroupNode(data, oldPaths[i]!);
        if (node) {
          setTokenNode(data, newPaths[i]!, structuredClone(node) as JsonObject);
          changed = true;
        }
      }
      if (changed) staged.push({ entry, content: stringifyDocument(data, detectFormat(entry.content)) });
    }
    return this.commitStaged(staged, { label: `Duplicate group ${groupPath.join('.')}` });
  }

  /** Apply a structured quick-fix (currently: replace a broken alias). */
  async applyQuickFix(
    id: string,
    action: string,
    mode: string | undefined,
    data: Record<string, unknown> | undefined,
  ): Promise<MutationResult> {
    if (action === 'replace-alias') {
      const newAlias = data?.['newAlias'];
      if (typeof newAlias !== 'string') return fail('invalid-token', `Missing newAlias`);
      const token = this.tokensById.get(id);
      if (!token) return fail('invalid-token', `Token not found`);
      const targetMode = mode ?? Object.keys(token.rawValuesByMode)[0]!;
      return this.updateValue(id, targetMode, newAlias);
    }
    return fail('invalid-token', `Unknown quick-fix action "${action}"`);
  }

  /**
   * Write `content` to `entry`'s file atomically (with a rotating backup),
   * update the in-memory cache, re-resolve, and return the ids of tokens whose
   * resolved value changed as a side effect.
   */
  private async commitFile(
    entry: FileEntry,
    content: string,
    meta?: HistoryMeta,
  ): Promise<string[]> {
    await this.backup(entry);
    const before = this.snapshotResolved();
    const fileBefore = entry.content;

    await writeFileAtomic(entry.abs, content);
    entry.content = content;
    entry.hash = hashContent(content);
    if (meta) this.recordHistory([{ rel: entry.rel, before: fileBefore, after: content }], meta);
    await this.reparse();

    const after = this.snapshotResolved();
    const affected: string[] = [];
    for (const [id, sig] of after) {
      if (before.get(id) !== sig) affected.push(id);
    }
    this.emit('event', { type: 'tokens-changed', affectedTokenIds: affected });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
    return affected;
  }

  private snapshotResolved(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [id, t] of this.tokensById) {
      out.set(id, JSON.stringify(t.resolvedValuesByMode));
    }
    return out;
  }

  // ---- Undo / Redo (byte-exact file history, Phase 3.6) ----

  /** Push a Command onto the history (no-op when nothing actually changed). */
  private recordHistory(edits: FileChange[], meta: HistoryMeta): void {
    this.history.record({ ...meta, changes: edits });
  }

  getHistoryState(): HistoryState {
    return this.history.state();
  }

  /**
   * Files whose current on-disk content differs from the snapshot the command
   * expects in the given direction (undo expects the "after" state to still be
   * on disk; redo expects the "before" state). A non-empty result means the file
   * was edited outside the tool since the command ran.
   */
  private async divergedFiles(
    changes: FileChange[],
    expect: 'before' | 'after',
  ): Promise<string[]> {
    const out: string[] = [];
    for (const c of changes) {
      // Compare the actual on-disk state to what the command expects in this
      // direction. `null` means "absent" — for created/deleted files (structural
      // commands) the file legitimately should not exist in one of the states.
      const onDisk = await this.readIfExists(join(this.root, c.rel));
      if (onDisk !== (expect === 'after' ? c.after : c.before)) out.push(c.rel);
    }
    return out;
  }

  /** Write a set of file contents (with backups), then reparse + broadcast. */
  private async applyFileContents(contents: Array<{ rel: string; content: string }>): Promise<void> {
    for (const c of contents) {
      const entry = this.files.get(join(this.root, c.rel));
      if (!entry) continue;
      await this.backup(entry);
      await writeFileAtomic(entry.abs, c.content);
      entry.content = c.content;
      entry.hash = hashContent(c.content);
      entry.readOnly = c.content.includes('<<<<<<<');
    }
    await this.reparse();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
  }

  /**
   * Apply a structural command's contents (the "before" or "after" of each
   * change): write/overwrite present files, delete absent (`null`) ones, then
   * re-read the config from disk and fully reload. Used for modes/collections,
   * whose undo/redo must revert the config + the set of files, not just bytes.
   */
  private async applyStructural(changes: FileChange[], dir: 'before' | 'after'): Promise<void> {
    for (const c of changes) {
      const abs = join(this.root, c.rel);
      const content = dir === 'before' ? c.before : c.after;
      if (content === null) {
        await rm(abs, { force: true }).catch(() => {});
      } else {
        await mkdir(dirname(abs), { recursive: true }).catch(() => {});
        await writeFileAtomic(abs, content);
      }
    }
    await this.reloadFromConfigOnDisk();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
  }

  /** Re-read tokenflow.config.json from disk, rebuild runtimes, and rescan + reparse. */
  private async reloadFromConfigOnDisk(): Promise<void> {
    const loaded = await loadConfig(this.root);
    this.config = loaded.config;
    this.organizationSource = loaded.organizationSource;
    this.manifestIssues = loaded.manifestIssues;
    this.autoDetect = loaded.source === null;
    this.collectionsLocked = loaded.organizationSource !== 'auto';
    this.rebuildRuntimes();
    await this.load();
  }

  /** Revert the most recent command (rewrite each touched file's "before"). */
  async undo(force = false): Promise<UndoRedoResult> {
    const cmd = this.history.peekUndo();
    if (!cmd) return { ok: false, reason: 'empty' };
    if (!force) {
      const diverged = await this.divergedFiles(cmd.changes, 'after');
      if (diverged.length > 0) return { ok: false, reason: 'diverged', diverged, label: cmd.label };
    }
    if (cmd.structural) await this.applyStructural(cmd.changes, 'before');
    else await this.applyFileContents(cmd.changes.map((c) => ({ rel: c.rel, content: c.before! })));
    this.history.commitUndo();
    return { ok: true, label: cmd.label, ...(cmd.tokenId ? { tokenId: cmd.tokenId } : {}) };
  }

  /** Re-apply the most recently undone command (rewrite each file's "after"). */
  async redo(force = false): Promise<UndoRedoResult> {
    const cmd = this.history.peekRedo();
    if (!cmd) return { ok: false, reason: 'empty' };
    if (!force) {
      const diverged = await this.divergedFiles(cmd.changes, 'before');
      if (diverged.length > 0) return { ok: false, reason: 'diverged', diverged, label: cmd.label };
    }
    if (cmd.structural) {
      await this.applyStructural(cmd.changes, 'after');
      this.history.commitRedo();
      return { ok: true, label: cmd.label, ...(cmd.tokenId ? { tokenId: cmd.tokenId } : {}) };
    }
    await this.applyFileContents(cmd.changes.map((c) => ({ rel: c.rel, content: c.after! })));
    this.history.commitRedo();
    return { ok: true, label: cmd.label, ...(cmd.tokenId ? { tokenId: cmd.tokenId } : {}) };
  }

  private async backup(entry: FileEntry): Promise<void> {
    const dir = join(this.root, BACKUP_DIR);
    await mkdir(dir, { recursive: true });
    const stamp = entry.hash.slice(0, 8);
    const safe = entry.rel.replace(/[\\/]/g, '__');
    await copyFile(entry.abs, join(dir, `${safe}.${stamp}.bak`)).catch(() => {});
    await this.rotateBackups(dir);
  }

  private async rotateBackups(dir: string): Promise<void> {
    try {
      const files = await readdir(dir);
      if (files.length <= BACKUP_ROTATION) return;
      const sorted = files.sort();
      for (const f of sorted.slice(0, files.length - BACKUP_ROTATION)) {
        await rm(join(dir, f)).catch(() => {});
      }
    } catch {
      /* best-effort */
    }
  }

  // ---- Reload (manual refresh) ----

  /**
   * Full refresh: re-detect collections (when auto-detected), re-scan files, and
   * re-resolve. Use after files are added, removed, or renamed on disk.
   */
  async reload(): Promise<void> {
    if (this.organizationSource === 'manifest') {
      // Re-read the manifest (+ settings) so external edits and newly-added files
      // take effect; the manifest stays the source of truth for organization.
      const loaded = await loadConfig(this.root);
      this.config = loaded.config;
      this.organizationSource = loaded.organizationSource;
      this.manifestIssues = loaded.manifestIssues;
      this.collectionsLocked = loaded.organizationSource !== 'auto';
      this.rebuildRuntimes();
    } else if (this.autoDetect && !this.collectionsLocked) {
      const collections = await detectCollections(this.root);
      if (collections.length > 0) {
        // Preserve any user-defined resolution order: keep still-valid entries in
        // place, then append newly-detected collections at the end.
        const names = collections.map((c) => c.name);
        const prev = this.config.resolution.order ?? [];
        const order = [
          ...prev.filter((n) => names.includes(n)),
          ...names.filter((n) => !prev.includes(n)),
        ];
        this.config = {
          ...this.config,
          collections,
          resolution: { ...this.config.resolution, order },
        };
        this.rebuildRuntimes();
      }
    }
    await this.load();
    this.restartWatching();
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
  }

  // ---- File watching ----

  startWatching(): void {
    if (this.watcher) return;
    // Watch ONLY the directories that contain token files, non-recursively
    // (depth 0). Watching the whole project root recursively exhausts file
    // handles (EMFILE) on large repos. New files in already-known dirs are
    // caught; brand-new directories are picked up via the refresh button.
    const dirs = new Set<string>();
    for (const abs of this.files.keys()) dirs.add(dirname(abs));
    if (dirs.size === 0) return;
    this.watcher = chokidar.watch([...dirs], {
      ignoreInitial: true,
      depth: 0,
      ignored: ['**/node_modules/**', '**/.tokenflow/**', '**/.git/**'],
    });
    this.watcher
      .on('add', (p) => this.onFsEvent('add', resolve(p)))
      .on('unlink', (p) => this.onFsEvent('unlink', resolve(p)))
      .on('change', (p) => this.onFsEvent('change', resolve(p)));
  }

  /** Tear down and re-create the watcher (e.g. after reload picks up new dirs). */
  private restartWatching(): void {
    if (!this.watcher) return;
    void this.watcher.close();
    this.watcher = null;
    this.startWatching();
  }

  private onFsEvent(type: 'add' | 'unlink' | 'change', abs: string): void {
    if (!abs.endsWith('.json')) return;
    const base = abs.split('/').pop()!;
    // Never react to the config file we write ourselves.
    if (base.endsWith('.config.json') || base === 'tokenflow.config.json') return;

    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      // change to a known file: cheap targeted reload; add/unlink: full reload.
      if (type === 'change' && this.files.has(abs)) void this.reloadFromDisk(abs);
      else void this.reload();
    }, this.config.writeDebounceMs);
  }

  private async reloadFromDisk(abs: string): Promise<void> {
    const entry = this.files.get(abs);
    if (!entry) {
      await this.reload();
      return;
    }
    if (!existsSync(abs)) {
      await this.reload();
      return;
    }
    const content = await readFile(abs, 'utf8');
    if (hashContent(content) === entry.hash) return; // our own write
    entry.content = content;
    entry.hash = hashContent(content);
    entry.readOnly = content.includes('<<<<<<<');
    await this.reparse();
    this.emit('event', { type: 'file-changed', file: relative(this.root, abs) });
    this.emit('event', { type: 'project-reloaded' });
    this.emit('event', { type: 'diagnostics-updated', diagnostics: this.diagnostics });
  }

  async dispose(): Promise<void> {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    await this.watcher?.close();
    this.watcher = null;
  }
}

/** True if `path` is `prefix` or starts with `prefix` followed by more segments. */
function startsWithPath(path: string[], prefix: string[]): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((s, i) => path[i] === s);
}

function fail(
  code: Parameters<typeof makeDiagnostic>[0],
  message: string,
  tokenId?: string,
  mode?: string,
): MutationResult {
  return {
    ok: false,
    affectedTokenIds: [],
    diagnostics: [
      makeDiagnostic(code, 'error', message, {
        ...(tokenId ? { tokenId } : {}),
        ...(mode ? { mode } : {}),
      }),
    ],
  };
}

function isInlineModeNode(data: Record<string, unknown>, path: string[]): boolean {
  let node: unknown = data;
  for (const seg of path) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[seg];
  }
  if (typeof node !== 'object' || node === null) return false;
  const value = (node as Record<string, unknown>)['$value'];
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Build the nested group tree (everything above leaf tokens) for the sidebar. */
function buildGroupTree(tokens: ParsedToken[]): GroupNode[] {
  const roots = new Map<string, GroupNode>();

  const ensureChild = (parent: GroupNode, name: string, path: string[]): GroupNode => {
    let child = parent.children.find((c) => c.name === name);
    if (!child) {
      child = { name, path, children: [], tokenCount: 0 };
      parent.children.push(child);
    }
    return child;
  };

  for (const t of tokens) {
    const groupPath = t.path.slice(0, -1);
    if (groupPath.length === 0) continue;
    const rootName = groupPath[0]!;
    let root = roots.get(rootName);
    if (!root) {
      root = { name: rootName, path: [rootName], children: [], tokenCount: 0 };
      roots.set(rootName, root);
    }
    root.tokenCount++;
    let current = root;
    for (let i = 1; i < groupPath.length; i++) {
      current = ensureChild(current, groupPath[i]!, groupPath.slice(0, i + 1));
      current.tokenCount++;
    }
  }

  return [...roots.values()];
}
