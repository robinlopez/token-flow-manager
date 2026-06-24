import type { TokenPath } from '@tokenflow/shared';
import type { RawToken } from './parser.js';

/** Known mode keywords (case-insensitive), in addition to the `mode*` prefix. */
const MODE_KEYWORDS = new Set([
  'light',
  'dark',
  'highcontrast',
  'hc',
  'lighthighcontrast',
  'darkhighcontrast',
  'lighthc',
  'darkhc',
]);

/** Does a path segment look like a mode name (e.g. "modeLight", "dark")? */
export function isModeSegment(segment: string): boolean {
  if (/^mode[A-Z0-9]/.test(segment)) return true;
  return MODE_KEYWORDS.has(segment.toLowerCase());
}

export interface ModeDimension {
  /** Zero-based path depth at which the mode segment sits. */
  dimension: number;
  modes: string[];
}

/**
 * Detect a "mode dimension": a path depth where every distinct segment is a
 * mode-like name (modeLight/modeDark, light/dark, …). This is the Tokens-Studio /
 * PrimeNG convention where one path level encodes the theme mode.
 *
 * Conservative: requires the depth's segments to be entirely mode-like and at
 * least two distinct values, so ordinary group levels are never mistaken.
 */
export function detectModeDimension(paths: TokenPath[]): ModeDimension | undefined {
  const byDepth = new Map<number, Set<string>>();
  for (const p of paths) {
    // Exclude the leaf (last segment) — that's the token name, never a mode.
    for (let d = 0; d < p.length - 1; d++) {
      let set = byDepth.get(d);
      if (!set) {
        set = new Set();
        byDepth.set(d, set);
      }
      set.add(p[d]!);
    }
  }

  for (const [dimension, segs] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const values = [...segs];
    if (values.length >= 2 && values.every(isModeSegment)) {
      return { dimension, modes: values.sort() };
    }
  }
  return undefined;
}

/**
 * Merge raw tokens along a mode dimension: tokens sharing a logical path (path
 * with the mode segment removed) collapse into a single multi-mode token.
 *
 * `token.modeLight.surface = a` + `token.modeDark.surface = b`
 *   → logical `token.surface` with { modeLight: a, modeDark: b }.
 */
export function mergeByModeDimension(
  tokens: RawToken[],
  dim: ModeDimension,
  defaultMode: string,
): RawToken[] {
  const merged = new Map<string, RawToken>();

  for (const t of tokens) {
    const seg = t.path[dim.dimension];
    const isMode = seg !== undefined && dim.modes.includes(seg);
    const logicalPath = isMode
      ? [...t.path.slice(0, dim.dimension), ...t.path.slice(dim.dimension + 1)]
      : t.path;
    const mode = isMode ? seg! : defaultMode;
    const value = Object.values(t.rawValuesByMode)[0];
    const key = JSON.stringify(logicalPath);

    const existing = merged.get(key);
    if (existing) {
      existing.rawValuesByMode[mode] = value;
      // Token-level metadata may live on any one mode's physical node — surface
      // it on the merged token rather than keeping only the first node's.
      if (existing.description === undefined && t.description !== undefined) {
        existing.description = t.description;
      }
      if (existing.deprecated === undefined && t.deprecated !== undefined) {
        existing.deprecated = t.deprecated;
      }
    } else {
      merged.set(key, {
        path: logicalPath,
        collection: t.collection,
        group: logicalPath[0] ?? '',
        type: t.type,
        rawValuesByMode: { [mode]: value },
        ...(t.description !== undefined ? { description: t.description } : {}),
        ...(t.deprecated !== undefined ? { deprecated: t.deprecated } : {}),
        ...(t.extensions !== undefined ? { extensions: t.extensions } : {}),
        source: t.source,
      });
    }
  }

  return [...merged.values()];
}

/**
 * Merge raw tokens that share the same path into one multi-mode token by
 * combining their per-mode values. Use for file-based modes (strategy B), where
 * each source file was parsed with its mode as the single value key.
 *
 * `themeOne.json → primary.500 = #a` + `themeTwo.json → primary.500 = #b`
 *   → `primary.500` with { themeOne: #a, themeTwo: #b }.
 */
export function mergeByPath(tokens: RawToken[]): RawToken[] {
  const merged = new Map<string, RawToken>();
  for (const t of tokens) {
    const key = JSON.stringify(t.path);
    const existing = merged.get(key);
    if (existing) {
      Object.assign(existing.rawValuesByMode, t.rawValuesByMode);
    } else {
      merged.set(key, { ...t, rawValuesByMode: { ...t.rawValuesByMode } });
    }
  }
  return [...merged.values()];
}
