import {
  type Diagnostic,
  type ParsedToken,
  type TokenPath,
  isAlias,
  isCompositeType,
  parseAliasPath,
  makeDiagnostic,
} from '@tokenflow/shared';
import { pathKey, tokenId } from './id.js';
import type { RawToken } from './parser.js';

export interface CollectionInput {
  name: string;
  modes: string[];
  defaultMode: string;
  tokens: RawToken[];
}

export interface ResolveOptions {
  /** Resolution order; a collection may only reference itself or earlier ones. */
  order?: string[];
  crossCollection: boolean;
  maxAliasDepth: number;
}

export interface ResolveResult {
  tokens: ParsedToken[];
  diagnostics: Diagnostic[];
}

// Unit-separator: cannot appear in collection names or path segments.
const KEY_SEP = String.fromCharCode(31);

function makeKey(collection: string, pk: string): string {
  return `${collection}${KEY_SEP}${pk}`;
}

interface IndexEntry {
  raw: RawToken;
  collectionIndex: number;
  collectionName: string;
  key: string;
}

/**
 * Resolve every token's value per mode across all collections.
 * Detects broken aliases, cycles, type mismatches and excessive depth.
 */
export function resolveProject(
  collections: CollectionInput[],
  opts: ResolveOptions,
): ResolveResult {
  const order = opts.order ?? collections.map((c) => c.name);
  const orderIndex = new Map<string, number>();
  order.forEach((name, i) => orderIndex.set(name, i));
  const collectionRank = (name: string): number => orderIndex.get(name) ?? Number.MAX_SAFE_INTEGER;

  // Build lookup index. Key includes collection so identical paths in different
  // collections don't collide.
  const index = new Map<string, IndexEntry>();
  const byPathKey = new Map<string, IndexEntry[]>();
  collections.forEach((col, ci) => {
    for (const raw of col.tokens) {
      const pk = pathKey(raw.path);
      const entry: IndexEntry = {
        raw,
        collectionIndex: ci,
        collectionName: col.name,
        key: makeKey(col.name, pk),
      };
      index.set(entry.key, entry);
      const list = byPathKey.get(pk) ?? [];
      list.push(entry);
      byPathKey.set(pk, list);
    }
  });

  // Collection-namespace aliases (Tokens Studio / PrimeNG convention): a
  // reference like `{primitive.green.500}` names the COLLECTION as its first
  // segment, not a path segment — the token lives at `green.500` in the
  // `primitives` collection. Map each collection to the namespace(s) that may
  // prefix it: its name, its path leaf, and a singular/plural variant.
  const collectionNamespaces = new Map<string, string>();
  for (const col of collections) {
    const n = col.name.toLowerCase();
    // Candidate namespaces: the full name plus each "/"-separated segment
    // (handles both manifest names like "primitives" and auto-detected names
    // like "primitives/themeOne"), each with a singular/plural variant.
    const bases = new Set<string>([n, ...n.split('/')]);
    for (const base of bases) {
      const variant = base.endsWith('s') ? base.slice(0, -1) : `${base}s`;
      for (const v of [base, variant]) if (!collectionNamespaces.has(v)) collectionNamespaces.set(v, col.name);
    }
  }

  const allKnownPaths = [...byPathKey.keys()];
  const diagnostics: Diagnostic[] = [];
  const out: ParsedToken[] = [];

  for (const col of collections) {
    const modes = col.modes.length > 0 ? col.modes : [col.defaultMode];
    for (const raw of col.tokens) {
      const id = tokenId(col.name, raw.path);
      const tokenDiags: Diagnostic[] = [];
      const resolvedByMode: Record<string, unknown> = {};
      const aliasChains: Record<string, TokenPath[]> = {};
      let topLevelAlias = false;

      for (const mode of modes) {
        const rawVal = raw.rawValuesByMode[mode] ?? raw.rawValuesByMode[col.defaultMode];
        const chain: TokenPath[] = [];
        const result = resolveValue(rawVal, mode, {
          fromCollection: col.name,
          tokenType: raw.type,
          index,
          byPathKey,
          collectionNamespaces,
          collectionRank,
          crossCollection: opts.crossCollection,
          maxAliasDepth: opts.maxAliasDepth,
          allKnownPaths,
          diagnostics: tokenDiags,
          tokenId: id,
          visited: new Set<string>(),
          chain,
          depth: 0,
        });
        resolvedByMode[mode] = result;
        if (chain.length > 0) {
          aliasChains[mode] = chain;
          topLevelAlias = true;
        }
      }

      const token: ParsedToken = {
        id,
        path: raw.path,
        collection: col.name,
        group: raw.group,
        type: raw.type,
        rawValuesByMode: raw.rawValuesByMode,
        resolvedValuesByMode: resolvedByMode,
        isAlias: topLevelAlias,
        ...(Object.keys(aliasChains).length > 0 ? { aliasChainsByMode: aliasChains } : {}),
        ...(raw.description !== undefined ? { description: raw.description } : {}),
        ...(raw.deprecated !== undefined ? { deprecated: raw.deprecated } : {}),
        ...(raw.extensions !== undefined ? { extensions: raw.extensions } : {}),
        source: raw.source,
        diagnostics: tokenDiags,
      };
      // Incomplete override: a genuine multi-mode token that defines a value for
      // some modes but not all — the missing modes silently inherit the default,
      // which is easy to miss. Flag it as a warning (not for single-mode sets).
      if (col.modes.length > 1) {
        const defined = col.modes.filter((m) => raw.rawValuesByMode[m] !== undefined);
        if (defined.length > 0 && defined.length < col.modes.length) {
          const missing = col.modes.filter((m) => raw.rawValuesByMode[m] === undefined);
          const diag = makeDiagnostic(
            'incomplete-mode-override',
            'warning',
            `${raw.path.join('.')} has no value for mode${missing.length > 1 ? 's' : ''} ${missing.join(', ')} — it inherits "${col.defaultMode}".`,
            { tokenId: id, file: raw.source.file },
          );
          tokenDiags.push(diag);
        }
      }

      out.push(token);
      diagnostics.push(...tokenDiags);
    }
  }

  return { tokens: out, diagnostics };
}

interface ResolveCtx {
  fromCollection: string;
  tokenType: string;
  index: Map<string, IndexEntry>;
  byPathKey: Map<string, IndexEntry[]>;
  collectionNamespaces: Map<string, string>;
  collectionRank: (name: string) => number;
  crossCollection: boolean;
  maxAliasDepth: number;
  allKnownPaths: string[];
  diagnostics: Diagnostic[];
  tokenId: string;
  visited: Set<string>;
  chain: TokenPath[];
  depth: number;
}

function resolveValue(value: unknown, mode: string, ctx: ResolveCtx): unknown {
  if (isAlias(value)) {
    return resolveAlias(value, mode, ctx);
  }
  // Composite values may contain alias sub-properties.
  if (
    isCompositeType(ctx.tokenType as never) &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isAlias(v)) {
        // Sub-property aliases resolve independently (no top-level chain entry).
        out[k] = resolveAlias(v, mode, { ...ctx, chain: [], tokenType: 'unknown' });
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return value;
}

function resolveAlias(alias: string, mode: string, ctx: ResolveCtx): unknown {
  const targetPath = parseAliasPath(alias);
  if (!targetPath) return alias;

  if (ctx.depth + 1 > ctx.maxAliasDepth) {
    ctx.diagnostics.push(
      makeDiagnostic(
        'alias-too-deep',
        'warning',
        `Alias chain exceeds ${ctx.maxAliasDepth} levels`,
        { tokenId: ctx.tokenId, mode },
      ),
    );
    return undefined;
  }

  const target = findTarget(targetPath, ctx);
  if (!target) {
    const suggestion = nearestPath(pathKey(targetPath), ctx.allKnownPaths);
    const newAlias = suggestion ? `{${suggestion}}` : undefined;
    ctx.diagnostics.push(
      makeDiagnostic(
        'broken-alias',
        'error',
        `Alias "${alias}" points to a token that does not exist` +
          (suggestion ? ` — did you mean "{${suggestion}}"?` : ''),
        {
          tokenId: ctx.tokenId,
          mode,
          ...(newAlias
            ? {
                quickFixes: [
                  {
                    label: `Replace with ${newAlias}`,
                    action: 'replace-alias',
                    data: { newAlias },
                  },
                ],
              }
            : {}),
        },
      ),
    );
    return undefined;
  }

  // Cross-collection ordering guard.
  if (target.collectionName !== ctx.fromCollection) {
    if (!ctx.crossCollection) {
      ctx.diagnostics.push(
        makeDiagnostic(
          'cross-collection-order',
          'error',
          `Cross-collection aliases are disabled`,
          { tokenId: ctx.tokenId, mode },
        ),
      );
      return undefined;
    }
    if (ctx.collectionRank(target.collectionName) > ctx.collectionRank(ctx.fromCollection)) {
      // The reference points at a later collection in the resolution order. This
      // is unusual (base collections normally come first) but NOT fatal — resolve
      // it anyway and surface a soft warning. Re-ordering in Settings clears it.
      ctx.diagnostics.push(
        makeDiagnostic(
          'cross-collection-order',
          'warning',
          `"${ctx.fromCollection}" references later collection "${target.collectionName}" — consider moving "${target.collectionName}" earlier in the resolution order.`,
          { tokenId: ctx.tokenId, mode },
        ),
      );
      // fall through and resolve the value
    }
  }

  // Cycle detection via the visited set of target keys.
  if (ctx.visited.has(target.entry.key)) {
    ctx.diagnostics.push(
      makeDiagnostic('alias-cycle', 'error', `Alias cycle detected at "${pathKey(targetPath)}"`, {
        tokenId: ctx.tokenId,
        mode,
      }),
    );
    return undefined;
  }

  // Type mismatch (only meaningful at the top level when both sides are typed).
  if (
    ctx.depth === 0 &&
    ctx.tokenType !== 'unknown' &&
    target.entry.raw.type !== 'unknown' &&
    target.entry.raw.type !== ctx.tokenType
  ) {
    ctx.diagnostics.push(
      makeDiagnostic(
        'alias-type-mismatch',
        'error',
        `Type mismatch: "${ctx.tokenType}" aliases "${target.entry.raw.type}"`,
        { tokenId: ctx.tokenId, mode },
      ),
    );
  }

  ctx.chain.push(target.entry.raw.path);
  const visited = new Set(ctx.visited);
  visited.add(target.entry.key);

  const targetRaw =
    target.entry.raw.rawValuesByMode[mode] ?? Object.values(target.entry.raw.rawValuesByMode)[0];

  return resolveValue(targetRaw, mode, {
    ...ctx,
    fromCollection: target.collectionName,
    tokenType: target.entry.raw.type,
    visited,
    depth: ctx.depth + 1,
  });
}

interface TargetMatch {
  entry: IndexEntry;
  collectionName: string;
}

function findTarget(targetPath: TokenPath, ctx: ResolveCtx): TargetMatch | null {
  const pk = pathKey(targetPath);
  // Prefer same-collection match.
  const same = ctx.index.get(makeKey(ctx.fromCollection, pk));
  if (same) return { entry: same, collectionName: ctx.fromCollection };

  if (!ctx.crossCollection) return null;

  const candidates = ctx.byPathKey.get(pk);
  if (candidates && candidates.length > 0) {
    // Pick the highest-ranked allowed collection (closest before fromCollection).
    let best: TargetMatch | null = null;
    let bestRank = -1;
    const fromRank = ctx.collectionRank(ctx.fromCollection);
    for (const entry of candidates) {
      const rank = ctx.collectionRank(entry.collectionName);
      if (rank <= fromRank && rank > bestRank) {
        best = { entry, collectionName: entry.collectionName };
        bestRank = rank;
      }
    }
    // Still surface later-collection matches so the order guard can report them.
    if (best) return best;
    const first = candidates[0]!;
    return { entry: first, collectionName: first.collectionName };
  }

  // Collection-namespace alias: the first segment names a collection
  // (e.g. `{primitive.green.500}` → collection "primitives", path "green.500").
  if (targetPath.length > 1) {
    const nsCol = ctx.collectionNamespaces.get(targetPath[0]!.toLowerCase());
    if (nsCol && nsCol !== ctx.fromCollection) {
      const entry = ctx.index.get(makeKey(nsCol, pathKey(targetPath.slice(1))));
      if (entry) return { entry, collectionName: nsCol };
    }
  }
  return null;
}

/** Levenshtein-based nearest path for "did you mean" suggestions. */
function nearestPath(target: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(target, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (best && bestDist <= Math.max(2, Math.floor(target.length / 3))) return best;
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}
