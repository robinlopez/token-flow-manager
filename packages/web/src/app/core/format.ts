const ALIAS_CURLY = /^\{([^}]+)\}$/;
const ALIAS_POINTER = /^#\//;

export function isAliasValue(value: unknown): value is string {
  return typeof value === 'string' && (ALIAS_CURLY.test(value) || ALIAS_POINTER.test(value));
}

/** Human-readable path for an alias chip, e.g. `{color.gray.50}` -> `color/gray/50`. */
export function aliasLabel(value: string): string {
  const curly = ALIAS_CURLY.exec(value);
  if (curly) return curly[1]!.replace(/\./g, '/');
  if (ALIAS_POINTER.test(value)) return value.slice(2);
  return value;
}

/** Produce a CSS color string from a resolved value, or null if not color-like. */
export function cssColor(value: unknown): string | null {
  if (typeof value === 'string') {
    if (/^#([0-9a-fA-F]{3,8})$/.test(value)) return value;
    if (/^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(value)) return value;
    if (/^[a-zA-Z]+$/.test(value)) return value;
    return null;
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o['hex'] === 'string') return o['hex'];
  }
  return null;
}

/** Compact textual representation of a resolved value for table cells. */
export function formatValue(value: unknown, type: string): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (type === 'dimension' && value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('value' in o && 'unit' in o) return `${o['value']}${o['unit']}`;
  }
  // Gradient: array of { color, position } stops → "#000 0, #fff 1".
  if (type === 'gradient' && Array.isArray(value)) {
    return value
      .map((s) => {
        if (s && typeof s === 'object') {
          const o = s as Record<string, unknown>;
          return `${o['color'] ?? ''} ${o['position'] ?? ''}`.trim();
        }
        return String(s);
      })
      .join(', ');
  }
  if (Array.isArray(value)) return value.join(', ');
  return JSON.stringify(value);
}

/**
 * Best-effort type inference from a value (mirrors the server's `inferType`):
 * a bare numeric string is a dimension; a JSON number is a number. Used to give
 * an alias cell (whose own `$type` is unknown) an effective type for filtering.
 */
export function inferValueType(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value !== 'string') return 'unknown';
  const s = value.trim();
  if (/^#([0-9a-fA-F]{3,8})$/.test(s) || /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(s))
    return 'color';
  if (/^-?\d*\.?\d+(ms|s)$/.test(s)) return 'duration';
  if (/^-?\d*\.?\d+[a-z%]+$/i.test(s)) return 'dimension';
  if (/^-?\d*\.?\d+$/.test(s)) return 'dimension';
  return 'unknown';
}

/** Coarse family so numeric kinds (number/dimension/duration) alias each other. */
const TYPE_FAMILY: Record<string, string> = {
  number: 'numeric',
  dimension: 'numeric',
  duration: 'numeric',
};
export function typeFamily(type: string): string {
  return TYPE_FAMILY[type] ?? type;
}

/**
 * The type to use for alias filtering: the declared type, or — when it is
 * unknown (e.g. the cell holds an alias) — inferred from the resolved/raw value.
 */
export function effectiveType(type: string, resolved: unknown, raw?: unknown): string {
  if (type && type !== 'unknown') return type;
  const fromResolved = inferValueType(resolved);
  if (fromResolved !== 'unknown') return fromResolved;
  return inferValueType(raw);
}

/** Two tokens can alias each other when their type families match (or unknown). */
export function typesCompatible(a: string, b: string): boolean {
  if (a === 'unknown' || b === 'unknown') return true;
  return typeFamily(a) === typeFamily(b);
}

/**
 * Sub-property → DTCG type for each composite type. Drives the per-field editor
 * in the composite editor (a colour field gets the colour/alias picker, a metric
 * field gets the alias picker). Unknown keys fall back to free-text.
 */
const COMPOSITE_FIELD_TYPES: Record<string, Record<string, string>> = {
  typography: {
    fontFamily: 'fontFamily',
    fontSize: 'dimension',
    fontWeight: 'fontWeight',
    lineHeight: 'number',
    letterSpacing: 'dimension',
    paragraphSpacing: 'dimension',
    paragraphIndent: 'dimension',
  },
  shadow: {
    color: 'color',
    offsetX: 'dimension',
    offsetY: 'dimension',
    blur: 'dimension',
    spread: 'dimension',
  },
  border: { color: 'color', width: 'dimension', style: 'strokeStyle' },
  transition: { duration: 'duration', delay: 'duration', timingFunction: 'cubicBezier' },
  gradient: { color: 'color', position: 'number' },
};

/** DTCG type of a composite's sub-property (`'unknown'` when unmapped). */
export function compositeFieldType(compositeType: string, key: string): string {
  return COMPOSITE_FIELD_TYPES[compositeType]?.[key] ?? 'unknown';
}

/** True for metric types that can be linked to a numeric alias. */
export function isMetricType(type: string): boolean {
  return typeFamily(type) === 'numeric';
}

/**
 * A sensible starter `$value` for a newly created token of `type` — used when
 * the user adds a variable (toolbar "Create variable" or a group's `+`). Each
 * mode is seeded with a deep clone of this (so composite/array values aren't
 * shared between modes). Mirrors the DTCG sub-property shapes in
 * `COMPOSITE_FIELD_TYPES`.
 */
export function defaultValueForType(type: string): unknown {
  switch (type) {
    case 'color':
      return '#000000';
    case 'dimension':
      return '0px';
    case 'number':
      return 0;
    case 'duration':
      return '0ms';
    case 'fontFamily':
      return 'sans-serif';
    case 'fontWeight':
      return 400;
    case 'cubicBezier':
      return [0.25, 0.1, 0.25, 1];
    case 'strokeStyle':
      return 'solid';
    case 'typography':
      return {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        fontWeight: 400,
        lineHeight: 1.5,
        letterSpacing: '0',
      };
    case 'shadow':
      return { color: '#000000', offsetX: '0px', offsetY: '0px', blur: '0px', spread: '0px' };
    case 'border':
      return { color: '#000000', width: '1px', style: 'solid' };
    case 'transition':
      return { duration: '0ms', delay: '0ms', timingFunction: [0.25, 0.1, 0.25, 1] };
    case 'gradient':
      return [
        { color: '#000000', position: 0 },
        { color: '#ffffff', position: 1 },
      ];
    default:
      return '';
  }
}

/** Single-character glyph per DTCG type for the table icon. */
export function typeGlyph(type: string): string {
  switch (type) {
    case 'color':
      return '◐';
    case 'dimension':
      return '#';
    case 'number':
      return '№';
    case 'fontFamily':
      return 'Aa';
    case 'fontWeight':
      return 'W';
    case 'duration':
      return '⏱';
    case 'typography':
      return '¶';
    case 'shadow':
      return '❏';
    case 'border':
      return '▢';
    case 'gradient':
      return '▧';
    default:
      return '◇';
  }
}
