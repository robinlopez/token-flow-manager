/**
 * DTCG (Design Tokens Format Module) 2025.10 type definitions.
 *
 * Reference: https://www.designtokens.org/tr/drafts/format/
 *
 * These describe the *on-disk* JSON shape. The in-memory manipulation model
 * lives in `model.ts`.
 */

/** The full set of `$type` values defined by DTCG 2025.10. */
export const DTCG_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'cubicBezier',
  'number',
  'strokeStyle',
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
] as const;

export type DtcgType = (typeof DTCG_TYPES)[number];

/** Scalar (non-composite) token types — their `$value` is a primitive. */
export const SCALAR_TYPES = [
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'number',
] as const;

/** Composite token types — their `$value` is a structured object. */
export const COMPOSITE_TYPES = [
  'strokeStyle',
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
  'cubicBezier',
] as const;

export function isDtcgType(value: unknown): value is DtcgType {
  return typeof value === 'string' && (DTCG_TYPES as readonly string[]).includes(value);
}

export function isCompositeType(type: string): boolean {
  return (COMPOSITE_TYPES as readonly string[]).includes(type);
}

/**
 * Best-effort inference of a DTCG type from a raw value. Used for tolerant
 * parsing of files that omit `$type` (or use a generic marker like
 * "design-token"). Returns undefined when no confident match.
 */
export function inferType(value: unknown): DtcgType | undefined {
  if (typeof value === 'number') return 'number';
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (/^#([0-9a-fA-F]{3,8})$/.test(v)) return 'color';
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(v)) return 'color';
  if (/^-?\d*\.?\d+(ms|s)$/.test(v)) return 'duration';
  if (/^-?\d*\.?\d+[a-z%]+$/i.test(v)) return 'dimension';
  // A bare numeric STRING (e.g. "0", "16") is a dimension in design-token files
  // (spacing/breakpoints write "0" for zero). True unitless numbers (line-height,
  // opacity) are JSON numbers, handled above → 'number'. This keeps a group like
  // breakpoints { phone:"0", tablet:"600px" } uniformly typed as dimension.
  if (/^-?\d*\.?\d+$/.test(v)) return 'dimension';
  return undefined;
}

/** Fallback type label for an untyped, non-inferable token (kept out of the DTCG enum). */
export const UNTYPED = 'unknown';

/**
 * An alias reference. DTCG 2025.10 supports two syntaxes:
 *  - curly braces: `"{group.subgroup.token}"`
 *  - JSON Pointer: `"#/group/subgroup/token"`
 */
export type AliasRef = string;

const CURLY_ALIAS = /^\{([^}]+)\}$/;
const POINTER_ALIAS = /^#\//;

export function isAlias(value: unknown): value is AliasRef {
  if (typeof value !== 'string') return false;
  return CURLY_ALIAS.test(value) || POINTER_ALIAS.test(value);
}

/**
 * Parse an alias string into a token path (array of segments).
 * Returns `null` if the string is not a valid alias.
 */
export function parseAliasPath(value: string): string[] | null {
  const curly = CURLY_ALIAS.exec(value);
  if (curly) {
    return curly[1]!.split('.').map((s) => s.trim()).filter(Boolean);
  }
  if (POINTER_ALIAS.test(value)) {
    return value
      .slice(2)
      .split('/')
      .map((s) => decodeJsonPointerSegment(s))
      .filter(Boolean);
  }
  return null;
}

/** Build a curly-brace alias string from a path. */
export function pathToAlias(path: string[]): AliasRef {
  return `{${path.join('.')}}`;
}

function decodeJsonPointerSegment(segment: string): string {
  // RFC 6901: ~1 -> "/", ~0 -> "~"
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Reserved DTCG property keys (everything else in an object is a child node). */
export const DTCG_RESERVED_KEYS = [
  '$value',
  '$type',
  '$description',
  '$extensions',
  '$deprecated',
  '$extends',
] as const;

export function isReservedKey(key: string): boolean {
  return key.startsWith('$');
}

/** A raw DTCG token node (has a `$value`). */
export interface DtcgToken {
  $value: unknown;
  $type?: DtcgType;
  $description?: string;
  $extensions?: Record<string, unknown>;
  $deprecated?: boolean | string;
  $extends?: AliasRef;
}

/** A raw DTCG group node (no `$value`; may carry inherited `$type`). */
export interface DtcgGroup {
  $type?: DtcgType;
  $description?: string;
  $extensions?: Record<string, unknown>;
  $deprecated?: boolean | string;
  [child: string]: unknown;
}

export type DtcgNode = DtcgToken | DtcgGroup;

export function isDtcgToken(node: unknown): node is DtcgToken {
  return typeof node === 'object' && node !== null && '$value' in node;
}

export function isDtcgGroup(node: unknown): node is DtcgGroup {
  return typeof node === 'object' && node !== null && !('$value' in node) && !Array.isArray(node);
}
