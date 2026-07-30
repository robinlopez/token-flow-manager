import {
  type TokenDialect,
  type TokenPath,
  documentDialect,
  envelopeFor,
  envelopeOf,
  isTokenNode,
  toLegacyType,
} from '@tokenflow/shared';

/**
 * Surgical, format-preserving mutation of a token JSON document.
 *
 * Rather than reconstructing JSON from the internal model (lossy), we parse the
 * file to a plain object (JS preserves key insertion order), mutate the target
 * node in place, and re-stringify with the file's detected indentation. This
 * keeps key order and structure intact; only the edited value changes.
 *
 * Every helper here reads the *dialect of the node it touches* rather than
 * assuming DTCG, so a legacy Tokens Studio file (`value`/`type`) round-trips
 * unchanged: editing one token rewrites that token's value and nothing else.
 */

export type JsonObject = Record<string, unknown>;

export interface DocumentFormat {
  /** Indentation unit, e.g. "  " or "\t". */
  indent: string;
  /** Whether the file ended with a trailing newline. */
  trailingNewline: boolean;
}

export function detectFormat(content: string): DocumentFormat {
  const tabMatch = /\n(\t+)\S/.exec(content);
  if (tabMatch) return { indent: '\t', trailingNewline: content.endsWith('\n') };
  const spaceMatch = /\n( +)\S/.exec(content);
  const indent = spaceMatch ? spaceMatch[1]! : '  ';
  return { indent, trailingNewline: content.endsWith('\n') };
}

export function parseDocument(content: string): JsonObject {
  const data = JSON.parse(content);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Token document root must be a JSON object');
  }
  return data as JsonObject;
}

export function stringifyDocument(data: JsonObject, format: DocumentFormat): string {
  const json = JSON.stringify(data, null, format.indent);
  return format.trailingNewline ? json + '\n' : json;
}

/** Navigate to the token node at `path`, returning it (or null). */
export function getTokenNode(data: JsonObject, path: TokenPath): JsonObject | null {
  let node: unknown = data;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as JsonObject)[segment];
  }
  if (isTokenNode(node)) {
    return node as JsonObject;
  }
  return null;
}

/**
 * Set a token's value for a given mode, in the node's own dialect.
 *
 * - Single-mode (`isInlineMode` false): replaces the value wholesale.
 * - Inline-mode: the value is an object keyed by mode; only `mode` is replaced.
 */
export function setTokenValue(
  data: JsonObject,
  path: TokenPath,
  mode: string,
  value: unknown,
  opts: { inlineMode: boolean } = { inlineMode: false },
): boolean {
  const node = getTokenNode(data, path);
  if (!node) return false;
  const valueKey = envelopeOf(node)!.value;

  if (opts.inlineMode) {
    const current = node[valueKey];
    const obj =
      typeof current === 'object' && current !== null && !Array.isArray(current)
        ? { ...(current as JsonObject) }
        : {};
    obj[mode] = value;
    node[valueKey] = obj;
  } else {
    node[valueKey] = value;
  }
  return true;
}

/**
 * Set (or clear) a token's description, in the node's own dialect. An
 * empty/whitespace string removes the key so we don't leave `"$description": ""`
 * cluttering the file.
 */
export function setTokenDescription(
  data: JsonObject,
  path: TokenPath,
  description: string,
): boolean {
  const node = getTokenNode(data, path);
  if (!node) return false;
  const key = envelopeOf(node)!.description;
  const trimmed = description.trim();
  if (trimmed) node[key] = trimmed;
  else delete node[key];
  return true;
}

/**
 * Build a token node in `dialect`, so a token created inside a legacy file is
 * written as `value`/`type` and stays readable by the Figma plugin.
 */
export function makeTokenNode(
  dialect: TokenDialect,
  fields: { type?: string; value: unknown; description?: string },
): JsonObject {
  const env = envelopeFor(dialect);
  const node: JsonObject = {};
  if (fields.type !== undefined) {
    node[env.type] = dialect === 'legacy' ? toLegacyType(fields.type) : fields.type;
  }
  if (fields.description) node[env.description] = fields.description;
  node[env.value] = fields.value;
  return node;
}

/** The dialect a new node should use to keep `data` homogeneous. */
export function dialectOfDocument(data: JsonObject): TokenDialect {
  return documentDialect(data);
}

/** Create or replace a token node at `path` (creating intermediate groups). */
export function setTokenNode(data: JsonObject, path: TokenPath, node: JsonObject): void {
  let parent: JsonObject = data;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    const next = parent[seg];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      parent[seg] = {};
    }
    parent = parent[seg] as JsonObject;
  }
  parent[path[path.length - 1]!] = node;
}

/** Navigate to a group (non-token) node at `path`. Root is `[]`. */
export function getGroupNode(data: JsonObject, path: TokenPath): JsonObject | null {
  let node: unknown = data;
  for (const seg of path) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
    node = (node as JsonObject)[seg];
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
  return node as JsonObject;
}

/**
 * Reorder the direct child keys of the group at `groupPath` to match
 * `orderedKeys`. Reserved (`$…`) keys keep their original relative order at the
 * front; children absent from `orderedKeys` are appended (safety). Structure and
 * values are untouched — only key order changes.
 */
export function reorderChildren(
  data: JsonObject,
  groupPath: TokenPath,
  orderedKeys: string[],
): boolean {
  const node = getGroupNode(data, groupPath);
  if (!node) return false;

  // Metadata is anything `$`-prefixed plus, for legacy files, the scalar
  // `description`/`type` keys: a child token or group is always an object, so
  // "not an object" is a dialect-free test for metadata.
  const entries = Object.entries(node);
  const isMeta = (k: string, v: unknown): boolean =>
    k.startsWith('$') || typeof v !== 'object' || v === null;
  const reserved = entries.filter(([k, v]) => isMeta(k, v));
  const childMap = new Map(entries.filter(([k, v]) => !isMeta(k, v)));

  const orderedChildren: [string, unknown][] = [];
  for (const k of orderedKeys) {
    if (childMap.has(k)) {
      orderedChildren.push([k, childMap.get(k)]);
      childMap.delete(k);
    }
  }
  for (const [k, v] of childMap) orderedChildren.push([k, v]); // leftovers

  for (const k of Object.keys(node)) delete node[k];
  for (const [k, v] of [...reserved, ...orderedChildren]) node[k] = v;
  return true;
}

/** Remove the token node at `path`. Returns true if something was removed. */
export function deleteTokenNode(data: JsonObject, path: TokenPath): boolean {
  let parent: unknown = data;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof parent !== 'object' || parent === null) return false;
    parent = (parent as JsonObject)[path[i]!];
  }
  if (typeof parent !== 'object' || parent === null) return false;
  const last = path[path.length - 1]!;
  if (!(last in (parent as JsonObject))) return false;
  delete (parent as JsonObject)[last];
  return true;
}

// ---- Mode operations (add / rename / remove a mode) ----
//
// Three storage strategies are supported. File-based modes (one file per mode)
// are handled at the ProjectManager level (copy/relabel files); the helpers here
// cover the two in-file strategies: a path-segment mode dimension, and inline
// per-mode `$value` objects. All rewrites preserve key order and structure.

const isObj = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rebuild an object with one key renamed, keeping every key's position. */
function renameKeyInPlace(node: JsonObject, from: string, to: string): boolean {
  if (!(from in node) || from === to) return false;
  const entries = Object.entries(node).map(([k, v]) => [k === from ? to : k, v] as const);
  for (const k of Object.keys(node)) delete node[k];
  for (const [k, v] of entries) node[k] = v;
  return true;
}

/**
 * Visit every object that holds mode keys at a given path depth (the "mode
 * dimension"). For dimension N, these are the objects reached after descending N
 * group segments from the root — e.g. dimension 1 visits `data.color`,
 * `data.space`, … whose children are `modeLight`/`modeDark`.
 */
function forEachModeContainer(
  data: JsonObject,
  dimension: number,
  fn: (container: JsonObject) => void,
): void {
  const walk = (node: JsonObject, depth: number): void => {
    if (depth === dimension) {
      fn(node);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !isObj(v) || isTokenNode(v)) continue;
      walk(v, depth + 1);
    }
  };
  walk(data, 0);
}

/** Duplicate a whole mode subtree at the mode dimension (`from` → `to`). */
export function duplicateModeAtDimension(
  data: JsonObject,
  dimension: number,
  from: string,
  to: string,
): number {
  let n = 0;
  forEachModeContainer(data, dimension, (container) => {
    if (from in container && !(to in container)) {
      container[to] = structuredClone(container[from]);
      n++;
    }
  });
  return n;
}

/** Rename a mode segment at the mode dimension, preserving position. */
export function renameModeAtDimension(
  data: JsonObject,
  dimension: number,
  from: string,
  to: string,
): number {
  let n = 0;
  forEachModeContainer(data, dimension, (container) => {
    if (renameKeyInPlace(container, from, to)) n++;
  });
  return n;
}

/** Remove a whole mode subtree at the mode dimension. */
export function removeModeAtDimension(data: JsonObject, dimension: number, mode: string): number {
  let n = 0;
  forEachModeContainer(data, dimension, (container) => {
    if (mode in container) {
      delete container[mode];
      n++;
    }
  });
  return n;
}

/** Visit every token node in the document, with the key its value lives under. */
function forEachTokenNode(data: JsonObject, fn: (node: JsonObject, valueKey: string) => void): void {
  const walk = (node: JsonObject): void => {
    const env = envelopeOf(node);
    if (env) {
      fn(node, env.value);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !isObj(v)) continue;
      walk(v);
    }
  };
  walk(data);
}

/** Duplicate an inline value mode (`from` → `to`) on every token. */
export function duplicateInlineMode(data: JsonObject, from: string, to: string): number {
  let n = 0;
  forEachTokenNode(data, (node, valueKey) => {
    const val = node[valueKey];
    if (isObj(val) && from in val && !(to in val)) {
      val[to] = structuredClone(val[from]);
      n++;
    }
  });
  return n;
}

/** Rename an inline value mode key (`from` → `to`) on every token, in place. */
export function renameInlineMode(data: JsonObject, from: string, to: string): number {
  let n = 0;
  forEachTokenNode(data, (node, valueKey) => {
    const val = node[valueKey];
    if (isObj(val) && renameKeyInPlace(val, from, to)) n++;
  });
  return n;
}

/** Remove an inline value mode key on every token. */
export function removeInlineMode(data: JsonObject, mode: string): number {
  let n = 0;
  forEachTokenNode(data, (node, valueKey) => {
    const val = node[valueKey];
    if (isObj(val) && mode in val) {
      delete val[mode];
      n++;
    }
  });
  return n;
}

/**
 * Convert a single-mode collection to inline modes: wrap every token's scalar
 * (or composite) value into `{ [existing]: value, [added]: copy }`. Tokens
 * already inline (a value carrying `existing`) are left untouched.
 */
export function wrapValuesAsInline(
  data: JsonObject,
  existing: string,
  added: string,
): number {
  let n = 0;
  forEachTokenNode(data, (node, valueKey) => {
    const val = node[valueKey];
    if (isObj(val) && existing in val) return; // already inline for this mode
    node[valueKey] = { [existing]: val, [added]: structuredClone(val) };
    n++;
  });
  return n;
}
