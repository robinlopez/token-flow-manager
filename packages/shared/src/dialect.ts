/**
 * Token dialects.
 *
 * The same data model ships in two JSON dialects:
 *  - **DTCG**: `$value` / `$type` / `$description`. The spec, and what this
 *    tool emits for new files.
 *  - **legacy Tokens Studio** (a.k.a. Figma Tokens): `value` / `type` /
 *    `description`, with its own type vocabulary (`fontSizes`, `boxShadow`, …).
 *    Still what the Figma plugin writes by default, so most files in the wild
 *    use it.
 *
 * The rule enforced here: normalize the *envelope* (which keys carry the value,
 * the type, the description) on read, and never touch the *payload*. Converting
 * values (`x`/`y` → `offsetX`/`offsetY`, `"150%"` → `1.5`) is lossy and
 * opinionated, so it stays an explicit user action rather than a side effect of
 * opening a file. Writes go back out in the dialect the file already used.
 *
 * Detection is **per node**, not per file: it costs nothing, survives mixed
 * files, and keeps every call site free of a `dialect` parameter to thread.
 */

import { type DtcgType, isAlias } from './dtcg.js';

export type TokenDialect = 'dtcg' | 'legacy';

/** Which keys carry a token's envelope in a given dialect. */
export interface TokenEnvelope {
  dialect: TokenDialect;
  value: '$value' | 'value';
  type: '$type' | 'type';
  description: '$description' | 'description';
}

export const DTCG_ENVELOPE: TokenEnvelope = {
  dialect: 'dtcg',
  value: '$value',
  type: '$type',
  description: '$description',
};

export const LEGACY_ENVELOPE: TokenEnvelope = {
  dialect: 'legacy',
  value: 'value',
  type: 'type',
  description: 'description',
};

export function envelopeFor(dialect: TokenDialect): TokenEnvelope {
  return dialect === 'legacy' ? LEGACY_ENVELOPE : DTCG_ENVELOPE;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The envelope of `node` if it is a token node, else null.
 *
 * `$value` always wins, so a DTCG file whose payload happens to contain a
 * `value` key (e.g. `{"$value": {"value": 16, "unit": "px"}}`) is never
 * misread. The remaining ambiguity is a *group* holding a child literally named
 * `value`; that child looks like a token node itself, which is how we tell the
 * two apart. A group carrying both a legacy `type` hint and a child named
 * `value` would still be misread as a token, which is why the `type` marker is
 * checked first only when it is a string.
 */
export function envelopeOf(node: unknown): TokenEnvelope | null {
  if (!isPlainObject(node)) return null;
  if ('$value' in node) return DTCG_ENVELOPE;
  if (!('value' in node)) return null;
  if (typeof node['type'] === 'string') return LEGACY_ENVELOPE;
  if (envelopeOf(node['value']) !== null) return null; // group child named "value"
  return LEGACY_ENVELOPE;
}

/** True if `node` carries a token value in either dialect. */
export function isTokenNode(node: unknown): boolean {
  return envelopeOf(node) !== null;
}

export interface DialectScan {
  /** `mixed` when both dialects appear, `none` when no token was found. */
  dialect: TokenDialect | 'mixed' | 'none';
  dtcg: number;
  legacy: number;
}

/** Count token nodes per dialect in a whole document (never enters payloads). */
export function scanDialect(root: unknown): DialectScan {
  let dtcg = 0;
  let legacy = 0;

  const walk = (node: unknown): void => {
    if (!isPlainObject(node)) return;
    const env = envelopeOf(node);
    if (env) {
      if (env.dialect === 'dtcg') dtcg++;
      else legacy++;
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      walk(child);
    }
  };
  walk(root);

  const dialect =
    dtcg > 0 && legacy > 0 ? 'mixed' : dtcg > 0 ? 'dtcg' : legacy > 0 ? 'legacy' : 'none';
  return { dialect, dtcg, legacy };
}

/**
 * The dialect a *new* node should be written in to keep `root` homogeneous.
 * Mixed or empty documents default to DTCG.
 */
export function documentDialect(root: unknown): TokenDialect {
  return scanDialect(root).dialect === 'legacy' ? 'legacy' : 'dtcg';
}

/**
 * Legacy Tokens Studio `type` names → DTCG `$type`.
 *
 * Only the *name* is translated; values stay verbatim, so a `boxShadow` keeps
 * its `x`/`y`/`spread` shape and a `lineHeights` keeps `"150%"`. DTCG's own
 * names are absent (they are recognized before this table is consulted), and so
 * are legacy names with no DTCG counterpart: `textCase`, `textDecoration`,
 * `composition`, `asset`, `other`, `text`, `boolean`. Those tokens stay untyped
 * and unmodified rather than being force-fit into the wrong type.
 */
export const LEGACY_TYPE_MAP: Readonly<Record<string, DtcgType>> = {
  sizing: 'dimension',
  spacing: 'dimension',
  borderWidth: 'dimension',
  borderRadius: 'dimension',
  letterSpacing: 'dimension',
  paragraphSpacing: 'dimension',
  paragraphIndent: 'dimension',
  fontSizes: 'dimension',
  fontSize: 'dimension',
  lineHeights: 'number',
  lineHeight: 'number',
  opacity: 'number',
  fontFamilies: 'fontFamily',
  fontWeights: 'fontWeight',
  boxShadow: 'shadow',
  borderStyle: 'strokeStyle',
};

/** DTCG type for a legacy type name, or undefined when there is no equivalent. */
export function mapLegacyType(name: unknown): DtcgType | undefined {
  return typeof name === 'string' ? LEGACY_TYPE_MAP[name] : undefined;
}

/**
 * DTCG type name → the legacy name Tokens Studio expects, where it differs.
 * Used when creating a token inside a legacy file, so the Figma plugin still
 * understands it. Names Tokens Studio shares with DTCG (`color`, `dimension`,
 * `typography`, `border`, `number`) are left alone; ambiguous ones (a dimension
 * could be `spacing`, `sizing`, `borderRadius`, …) deliberately keep the DTCG
 * name rather than guessing an intent.
 */
const DTCG_TO_LEGACY: Readonly<Partial<Record<DtcgType, string>>> = {
  shadow: 'boxShadow',
  fontFamily: 'fontFamilies',
  fontWeight: 'fontWeights',
  strokeStyle: 'borderStyle',
};

export function toLegacyType(type: string): string {
  return DTCG_TO_LEGACY[type as DtcgType] ?? type;
}

/** Where a mapped legacy type name is preserved, so writes stay faithful. */
export const SOURCE_TYPE_EXTENSION = 'com.tokenflow.sourceType';

// A Tokens Studio value may be arithmetic over references: `"{fontSize.base} * 0.75"`.
// It is neither a plain value nor an alias. We never evaluate it (that would
// require a unit-aware expression engine and would silently invent values), but
// we must (a) not flag it as invalid and (b) still see the references inside it,
// otherwise a rename would quietly break every expression pointing at the token.
const OPERATOR = /[+\-*/]/;
const PURE_ARITHMETIC = /^\(?\s*-?[\d.]+\s*\)?(\s*[+\-*/]\s*\(?\s*-?[\d.]+\s*\)?)+$/;
const REF_TOKEN = /\{([^{}]+)\}/g;

// `isAlias` is a type guard over `string`, which would narrow an already-string
// operand to `never` in the else branch. Keep it a plain predicate here.
const isWholeAlias = (s: string): boolean => isAlias(s);

const refPath = (inner: string): string[] =>
  inner
    .split('.')
    .map((seg) => seg.trim())
    .filter(Boolean);

/** True for a Tokens Studio math expression (`"{a.b} * 2"`, `"16 * 1.5"`). */
export function isExpression(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || isWholeAlias(s)) return false;
  const withoutRefs = s.replace(REF_TOKEN, '');
  // A reference plus an operator outside it.
  if (withoutRefs !== s && OPERATOR.test(withoutRefs)) return true;
  // Pure arithmetic needs two operands, so a negative value ("-4") is not one.
  return PURE_ARITHMETIC.test(s);
}

/**
 * Every `{a.b.c}` reference embedded in a string that is *not* a plain alias.
 * Returns paths, in order of appearance; empty for plain values and aliases.
 */
export function extractEmbeddedRefs(value: unknown): string[][] {
  if (typeof value !== 'string') return [];
  const s = value.trim();
  if (isWholeAlias(s)) return []; // whole-string alias: the alias code path owns it
  const out: string[][] = [];
  for (const m of s.matchAll(REF_TOKEN)) {
    const path = refPath(m[1]!);
    if (path.length > 0) out.push(path);
  }
  return out;
}

/**
 * Rewrite embedded `{old.path}` references inside a string, keeping everything
 * else (operators, spacing) byte-identical. Returns the new string and how many
 * references changed.
 */
export function rewriteEmbeddedRefs(
  value: string,
  oldPath: readonly string[],
  newPath: readonly string[],
): { value: string; count: number } {
  if (isWholeAlias(value.trim())) return { value, count: 0 };
  let count = 0;
  const next = value.replace(REF_TOKEN, (match, inner: string) => {
    const path = refPath(inner);
    if (path.length !== oldPath.length || !path.every((seg, i) => seg === oldPath[i])) {
      return match;
    }
    count++;
    return `{${newPath.join('.')}}`;
  });
  return { value: next, count };
}
