export const FIGMA_VENDOR = 'com.figma';

export const FIGMA_RESOLVED_TYPES = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'] as const;
export type FigmaResolvedType = (typeof FIGMA_RESOLVED_TYPES)[number];

export const VARIABLE_SCOPES = [
  'ALL_SCOPES',
  'ALL_FILLS',
  'FRAME_FILL',
  'SHAPE_FILL',
  'TEXT_FILL',
  'STROKE_COLOR',
  'EFFECT_COLOR',
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'TEXT_CONTENT',
  'STROKE_FLOAT',
  'OPACITY',
  'EFFECT_FLOAT',
  'FONT_FAMILY',
  'FONT_STYLE',
  'FONT_WEIGHT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
  'FONT_VARIATIONS',
] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];

const SCOPE_TYPES: Readonly<Record<VariableScope, readonly FigmaResolvedType[]>> = {
  ALL_SCOPES: ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'],
  ALL_FILLS: ['COLOR'],
  FRAME_FILL: ['COLOR'],
  SHAPE_FILL: ['COLOR'],
  TEXT_FILL: ['COLOR'],
  STROKE_COLOR: ['COLOR'],
  EFFECT_COLOR: ['COLOR'],
  CORNER_RADIUS: ['FLOAT'],
  WIDTH_HEIGHT: ['FLOAT'],
  GAP: ['FLOAT'],
  TEXT_CONTENT: ['FLOAT', 'STRING'],
  STROKE_FLOAT: ['FLOAT'],
  OPACITY: ['FLOAT'],
  EFFECT_FLOAT: ['FLOAT'],
  FONT_FAMILY: ['STRING'],
  FONT_STYLE: ['STRING'],
  FONT_WEIGHT: ['FLOAT'],
  FONT_SIZE: ['FLOAT'],
  LINE_HEIGHT: ['FLOAT'],
  LETTER_SPACING: ['FLOAT'],
  PARAGRAPH_SPACING: ['FLOAT'],
  PARAGRAPH_INDENT: ['FLOAT'],
  FONT_VARIATIONS: ['STRING'],
};

export const FIGMA_EDITABLE_KEYS = [
  'scopes',
  'hiddenFromPublishing',
  'codeSyntax',
  'resolvedType',
] as const;

export const FIGMA_IDENTITY_KEYS = ['variableId', 'collectionId', 'modeId', 'key'] as const;

export const CODE_SYNTAX_PLATFORMS = ['WEB', 'ANDROID', 'iOS'] as const;
export type CodeSyntaxPlatform = (typeof CODE_SYNTAX_PLATFORMS)[number];

const DTCG_TO_RESOLVED: Readonly<Record<string, FigmaResolvedType>> = {
  color: 'COLOR',
  dimension: 'FLOAT',
  number: 'FLOAT',
  duration: 'FLOAT',
  fontWeight: 'FLOAT',
  fontSize: 'FLOAT',
  lineHeights: 'FLOAT',
  spacing: 'FLOAT',
  sizing: 'FLOAT',
  borderRadius: 'FLOAT',
  borderWidth: 'FLOAT',
  opacity: 'FLOAT',
  fontFamily: 'STRING',
  fontFamilies: 'STRING',
  strokeStyle: 'STRING',
  string: 'STRING',
  text: 'STRING',
  boolean: 'BOOLEAN',
};

export function figmaResolvedType(dtcgType: string): FigmaResolvedType | null {
  return DTCG_TO_RESOLVED[dtcgType] ?? null;
}

export function isVariableScope(value: unknown): value is VariableScope {
  return typeof value === 'string' && (VARIABLE_SCOPES as readonly string[]).includes(value);
}

export function scopeAppliesTo(scope: VariableScope, type: FigmaResolvedType | null): boolean {
  return type === null || SCOPE_TYPES[scope].includes(type);
}

export function normalizeScopes(scopes: readonly unknown[]): VariableScope[] {
  const valid = scopes.filter(isVariableScope);
  if (valid.includes('ALL_SCOPES')) return ['ALL_SCOPES'];
  const set = new Set(valid);
  return VARIABLE_SCOPES.filter((s) => set.has(s));
}

export function validateFigmaPatch(
  patch: Record<string, unknown>,
  resolvedType: FigmaResolvedType | null,
): string | null {
  for (const key of Object.keys(patch)) {
    if ((FIGMA_IDENTITY_KEYS as readonly string[]).includes(key)) {
      return `"${key}" is a Figma binding identity and cannot be edited`;
    }
    if (!(FIGMA_EDITABLE_KEYS as readonly string[]).includes(key)) {
      return `Unknown ${FIGMA_VENDOR} field "${key}"`;
    }
  }
  if ('resolvedType' in patch && patch['resolvedType'] !== null) {
    const value = patch['resolvedType'];
    if (resolvedType === null) return `This token type has no Figma resolvedType`;
    if (value !== resolvedType) {
      return `resolvedType must be "${resolvedType}" for this token type`;
    }
  }
  if ('scopes' in patch && patch['scopes'] !== null) {
    const value = patch['scopes'];
    if (!Array.isArray(value)) return `scopes must be an array`;
    for (const s of value) {
      if (!isVariableScope(s)) return `Unknown Figma scope "${String(s)}"`;
      if (!scopeAppliesTo(s, resolvedType)) {
        return `Scope "${s}" does not apply to a ${resolvedType} variable`;
      }
    }
  }
  if ('hiddenFromPublishing' in patch && patch['hiddenFromPublishing'] !== null) {
    if (typeof patch['hiddenFromPublishing'] !== 'boolean') {
      return `hiddenFromPublishing must be a boolean`;
    }
  }
  if ('codeSyntax' in patch && patch['codeSyntax'] !== null) {
    const value = patch['codeSyntax'];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return `codeSyntax must be an object`;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!(CODE_SYNTAX_PLATFORMS as readonly string[]).includes(k)) {
        return `Unknown codeSyntax platform "${k}"`;
      }
      if (typeof v !== 'string') return `codeSyntax.${k} must be a string`;
    }
  }
  return null;
}
