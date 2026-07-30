import {
  type TokenPath,
  extractEmbeddedRefs,
  isAlias,
  parseAliasPath,
  pathToAlias,
  rewriteEmbeddedRefs,
} from '@tokenflow/shared';
import type { JsonObject } from './document.js';
import { getTokenNode } from './document.js';

/** True if `aliasStr` is an alias whose parsed path equals `path`. */
export function aliasPathEquals(aliasStr: unknown, path: TokenPath): boolean {
  if (!isAlias(aliasStr)) return false;
  const parsed = parseAliasPath(aliasStr);
  if (!parsed || parsed.length !== path.length) return false;
  return parsed.every((seg, i) => seg === path[i]);
}

/** Re-emit an alias string for `newPath`, preserving the original syntax. */
function reAlias(original: string, newPath: TokenPath): string {
  if (original.startsWith('#/')) {
    return '#/' + newPath.map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
  }
  return pathToAlias(newPath);
}

function refsInString(value: unknown, path: TokenPath): number {
  if (typeof value !== 'string') return 0;
  if (aliasPathEquals(value, path)) return 1;
  return extractEmbeddedRefs(value).filter(
    (ref) => ref.length === path.length && ref.every((seg, i) => seg === path[i]),
  ).length;
}

/**
 * Walk the whole document and rewrite every reference to `oldPath` so it points
 * at `newPath`. Handles whole-string aliases (preserving curly vs JSON-Pointer
 * syntax) and references embedded in Tokens Studio expressions
 * (`"{fontSize.base} * 0.75"`), which a rename would otherwise leave dangling.
 * Recurses into nested objects and arrays (composite sub-properties). Returns
 * the number of references rewritten.
 */
export function rewriteAliasReferences(
  data: JsonObject,
  oldPath: TokenPath,
  newPath: TokenPath,
): number {
  let count = 0;

  const rewritten = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    if (aliasPathEquals(v, oldPath)) {
      count++;
      return reAlias(v, newPath);
    }
    const embedded = rewriteEmbeddedRefs(v, oldPath, newPath);
    if (embedded.count > 0) {
      count += embedded.count;
      return embedded.value;
    }
    return null;
  };

  const visit = (container: Record<string, unknown> | unknown[]): void => {
    const keys: Array<string | number> = Array.isArray(container)
      ? container.map((_, i) => i)
      : Object.keys(container);
    for (const key of keys) {
      const v = (container as Record<string | number, unknown>)[key];
      const next = rewritten(v);
      if (next !== null) {
        (container as Record<string | number, unknown>)[key] = next;
      } else if (v && typeof v === 'object') {
        visit(v as Record<string, unknown> | unknown[]);
      }
    }
  };

  visit(data);
  return count;
}

export function countAliasReferences(data: JsonObject, targetPath: TokenPath): number {
  let count = 0;
  const visit = (container: Record<string, unknown> | unknown[]): void => {
    const values = Array.isArray(container) ? container : Object.values(container);
    for (const v of values) {
      const n = refsInString(v, targetPath);
      if (n > 0) count += n;
      else if (v && typeof v === 'object') visit(v as Record<string, unknown> | unknown[]);
    }
  };
  visit(data);
  return count;
}

/**
 * Move a token node from `oldPath` to `newPath` within a document, creating
 * intermediate groups for the destination and pruning emptied source groups.
 * Returns false if there is no token at `oldPath` or `newPath` is occupied.
 */
export function renameNode(data: JsonObject, oldPath: TokenPath, newPath: TokenPath): boolean {
  if (oldPath.length === 0 || newPath.length === 0) return false;
  const node = getTokenNode(data, oldPath);
  if (!node) return false;
  if (getTokenNode(data, newPath)) return false; // destination already a token

  // Detach from source.
  const srcParent = parentOf(data, oldPath);
  if (!srcParent) return false;
  delete srcParent[oldPath[oldPath.length - 1]!];

  // Attach at destination, creating groups as needed.
  let parent: JsonObject = data;
  for (let i = 0; i < newPath.length - 1; i++) {
    const seg = newPath[i]!;
    const next = parent[seg];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      parent[seg] = {};
    }
    parent = parent[seg] as JsonObject;
  }
  parent[newPath[newPath.length - 1]!] = node;

  // Prune groups left empty by the move (after re-attaching, so a shared
  // destination group isn't wrongly removed).
  pruneEmptyGroups(data, oldPath.slice(0, -1));
  return true;
}

function parentOf(data: JsonObject, path: TokenPath): JsonObject | null {
  let node: unknown = data;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as JsonObject)[path[i]!];
  }
  return typeof node === 'object' && node !== null ? (node as JsonObject) : null;
}

/** Remove now-empty group objects left behind after a node move, bottom-up. */
function pruneEmptyGroups(data: JsonObject, groupPath: TokenPath): void {
  for (let depth = groupPath.length; depth >= 1; depth--) {
    const path = groupPath.slice(0, depth);
    const parent = parentOf(data, path);
    if (!parent) continue;
    const key = path[path.length - 1]!;
    const group = parent[key];
    if (
      group &&
      typeof group === 'object' &&
      !Array.isArray(group) &&
      Object.entries(group as JsonObject).filter(
        ([k, v]) => !k.startsWith('$') && typeof v === 'object' && v !== null,
      ).length === 0
    ) {
      delete parent[key];
    } else {
      break;
    }
  }
}
