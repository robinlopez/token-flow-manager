import { type Diagnostic, isAlias, makeDiagnostic } from '@tokenflow/shared';

/**
 * Lightweight value validation per DTCG type. Aliases are always accepted here
 * (reference integrity is the resolver's job). Returns a diagnostic message, or
 * null if the value is acceptable.
 *
 * Deliberately lenient: accepts both structured dimensions (`{value,unit}`) and
 * shorthand strings (`"2rem"`) to interop with real-world token files.
 */
export function validateValue(value: unknown, type: string): string | null {
  if (isAlias(value)) return null;
  if (value === undefined || value === null) return 'Value is missing';

  switch (type) {
    case 'color':
      return isColorLike(value) ? null : 'Expected a color string or color object';
    case 'dimension':
      return isDimensionLike(value) ? null : 'Expected a dimension (number+unit or string)';
    case 'number':
      // Accept numeric strings too ("0", "1.5") — real files often quote numbers.
      return typeof value === 'number' || (typeof value === 'string' && /^-?\d*\.?\d+$/.test(value.trim()))
        ? null
        : 'Expected a number';
    case 'fontWeight':
      return typeof value === 'number' || typeof value === 'string'
        ? null
        : 'Expected a font weight (number or keyword)';
    case 'fontFamily':
      return typeof value === 'string' || isStringArray(value)
        ? null
        : 'Expected a font family string or array';
    case 'duration':
      return isDimensionLike(value) ? null : 'Expected a duration (e.g. "200ms")';
    default:
      // Composite types validated structurally elsewhere; accept for now.
      return typeof value === 'object' && value !== null ? null : null;
  }
}

export function validateToken(
  value: unknown,
  type: string,
  tokenId: string,
  mode?: string,
): Diagnostic[] {
  const msg = validateValue(value, type);
  if (!msg) return [];
  return [
    makeDiagnostic('invalid-token', 'error', msg, {
      tokenId,
      ...(mode !== undefined ? { mode } : {}),
    }),
  ];
}

const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CSS_COLOR_FN = /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i;

function isColorLike(value: unknown): boolean {
  if (typeof value === 'string') {
    return HEX.test(value) || CSS_COLOR_FN.test(value) || /^[a-zA-Z]+$/.test(value);
  }
  // DTCG color object: { colorSpace, components, alpha?, hex? }
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return 'colorSpace' in o || 'components' in o || 'hex' in o;
  }
  return false;
}

// A bare number ("0") or a number followed by any CSS unit ("16px", "2rem", "10ch").
const DIM_STRING = /^-?\d*\.?\d+([a-z%]+)?$/i;

function isDimensionLike(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return DIM_STRING.test(value.trim());
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return typeof o['value'] === 'number' && typeof o['unit'] === 'string';
  }
  return false;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
