import type { ParsedToken } from './models';

export const FIGMA_VENDOR = 'com.figma';

export type FigmaResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export type FieldRole = 'editable' | 'derived' | 'identity';

export interface ExtensionFieldSpec {
  key: string;
  label: string;
  role: FieldRole;
  kind: 'scopes' | 'boolean' | 'codeSyntax' | 'text';
}

export interface ExtensionService {
  vendor: string;
  label: string;
  icon: 'figma';
  fields: ExtensionFieldSpec[];
  supports(token: ParsedToken): boolean;
  seed(token: ParsedToken): Record<string, unknown>;
}

export interface ScopeOption {
  value: string;
  label: string;
  types: FigmaResolvedType[];
  group?: string;
  depth?: number;
}

export const ALL_SCOPES = 'ALL_SCOPES';
export const ALL_FILLS = 'ALL_FILLS';
export const FILL_CHILDREN = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'];

const TYPOGRAPHY = 'Typography';

export const FIGMA_SCOPES: ScopeOption[] = [
  { value: 'ALL_SCOPES', label: 'Show in all supported properties', types: ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'] },
  { value: 'ALL_FILLS', label: 'Fill', types: ['COLOR'] },
  { value: 'FRAME_FILL', label: 'Frame', types: ['COLOR'], depth: 1 },
  { value: 'SHAPE_FILL', label: 'Shape', types: ['COLOR'], depth: 1 },
  { value: 'TEXT_FILL', label: 'Text', types: ['COLOR'], depth: 1 },
  { value: 'STROKE_COLOR', label: 'Stroke', types: ['COLOR'] },
  { value: 'EFFECT_COLOR', label: 'Effects', types: ['COLOR'] },
  { value: 'CORNER_RADIUS', label: 'Corner radius', types: ['FLOAT'] },
  { value: 'WIDTH_HEIGHT', label: 'Width and height', types: ['FLOAT'] },
  { value: 'GAP', label: 'Gap (Auto layout)', types: ['FLOAT'] },
  { value: 'TEXT_CONTENT', label: 'Text content', types: ['FLOAT', 'STRING'] },
  { value: 'STROKE_FLOAT', label: 'Stroke', types: ['FLOAT'] },
  { value: 'OPACITY', label: 'Layer opacity', types: ['FLOAT'] },
  { value: 'EFFECT_FLOAT', label: 'Effects', types: ['FLOAT'] },
  { value: 'FONT_FAMILY', label: 'Font family', types: ['STRING'], group: TYPOGRAPHY },
  { value: 'FONT_STYLE', label: 'Font style', types: ['STRING'], group: TYPOGRAPHY },
  { value: 'FONT_VARIATIONS', label: 'Font variations', types: ['STRING'], group: TYPOGRAPHY },
  { value: 'FONT_WEIGHT', label: 'Font weight', types: ['FLOAT'], group: TYPOGRAPHY },
  { value: 'FONT_SIZE', label: 'Font size', types: ['FLOAT'], group: TYPOGRAPHY },
  { value: 'LINE_HEIGHT', label: 'Line height', types: ['FLOAT'], group: TYPOGRAPHY },
  { value: 'LETTER_SPACING', label: 'Letter spacing', types: ['FLOAT'], group: TYPOGRAPHY },
  { value: 'PARAGRAPH_SPACING', label: 'Paragraph spacing', types: ['FLOAT'], group: TYPOGRAPHY },
  { value: 'PARAGRAPH_INDENT', label: 'Paragraph indent', types: ['FLOAT'], group: TYPOGRAPHY },
];

const SCOPE_ORDER = new Map(FIGMA_SCOPES.map((s, i) => [s.value, i]));

const DTCG_TO_RESOLVED: Record<string, FigmaResolvedType> = {
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

export const CODE_SYNTAX_PLATFORMS = ['WEB', 'ANDROID', 'iOS'] as const;
export type CodeSyntaxPlatform = (typeof CODE_SYNTAX_PLATFORMS)[number];

export function figmaResolvedType(dtcgType: string): FigmaResolvedType | null {
  return DTCG_TO_RESOLVED[dtcgType] ?? null;
}

export function scopeOptionsFor(types: FigmaResolvedType[]): ScopeOption[] {
  if (types.length === 0) return [];
  return FIGMA_SCOPES.filter((s) => types.some((t) => s.types.includes(t)));
}

export function scopeAppliesTo(scope: ScopeOption, type: FigmaResolvedType | null): boolean {
  return type !== null && scope.types.includes(type);
}

export function extensionBlock(token: ParsedToken, vendor: string): Record<string, unknown> | null {
  const block = token.extensions?.[vendor];
  return block && typeof block === 'object' && !Array.isArray(block)
    ? (block as Record<string, unknown>)
    : null;
}

export function tokenScopes(token: ParsedToken): string[] {
  const raw = extensionBlock(token, FIGMA_VENDOR)?.['scopes'];
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

export function normalizeScopes(scopes: string[]): string[] {
  if (scopes.includes(ALL_SCOPES)) return [ALL_SCOPES];
  const unique = [...new Set(scopes)];
  return unique.sort((a, b) => (SCOPE_ORDER.get(a) ?? 99) - (SCOPE_ORDER.get(b) ?? 99));
}

export function isScopeOn(scopes: string[], scope: string): boolean {
  if (scope === ALL_SCOPES) return scopes.includes(ALL_SCOPES);
  if (scope === ALL_FILLS) {
    return scopes.includes(ALL_FILLS) || FILL_CHILDREN.every((c) => scopes.includes(c));
  }
  if (FILL_CHILDREN.includes(scope)) return scopes.includes(scope) || scopes.includes(ALL_FILLS);
  return scopes.includes(scope);
}

export function toggleScope(scopes: string[], scope: string, next: boolean): string[] {
  if (scope === ALL_SCOPES) return next ? [ALL_SCOPES] : [];
  let out = scopes.filter((s) => s !== ALL_SCOPES);

  if (scope === ALL_FILLS) {
    out = out.filter((s) => s !== ALL_FILLS && !FILL_CHILDREN.includes(s));
    if (next) out.push(ALL_FILLS);
  } else if (FILL_CHILDREN.includes(scope)) {
    if (out.includes(ALL_FILLS)) {
      out = out.filter((s) => s !== ALL_FILLS).concat(FILL_CHILDREN);
    }
    out = out.filter((s) => s !== scope);
    if (next) out.push(scope);
  } else {
    out = out.filter((s) => s !== scope);
    if (next) out.push(scope);
  }
  return normalizeScopes(out);
}

export type TriState = 'on' | 'off' | 'mixed';

export function triState(values: boolean[]): TriState {
  if (values.length === 0) return 'off';
  if (values.every((v) => v)) return 'on';
  if (values.every((v) => !v)) return 'off';
  return 'mixed';
}

const FIGMA_SERVICE: ExtensionService = {
  vendor: FIGMA_VENDOR,
  label: 'Figma',
  icon: 'figma',
  fields: [
    { key: 'scopes', label: 'Scopes', role: 'editable', kind: 'scopes' },
    { key: 'hiddenFromPublishing', label: 'Hidden from publishing', role: 'editable', kind: 'boolean' },
    { key: 'codeSyntax', label: 'Code syntax', role: 'editable', kind: 'codeSyntax' },
    { key: 'resolvedType', label: 'Resolved type', role: 'derived', kind: 'text' },
    { key: 'variableId', label: 'Variable ID', role: 'identity', kind: 'text' },
    { key: 'collectionId', label: 'Collection ID', role: 'identity', kind: 'text' },
    { key: 'modeId', label: 'Mode ID', role: 'identity', kind: 'text' },
  ],
  supports: (token) => figmaResolvedType(token.type) !== null,
  seed: (token) => ({ resolvedType: figmaResolvedType(token.type) }),
};

export const EXTENSION_SERVICES: ExtensionService[] = [FIGMA_SERVICE];

export interface ServiceAvailability {
  service: ExtensionService;
  present: number;
  supported: number;
  missing: number;
}

export function servicesFor(tokens: ParsedToken[]): ServiceAvailability[] {
  return EXTENSION_SERVICES.map((service) => {
    const supported = tokens.filter((t) => service.supports(t));
    const present = tokens.filter((t) => extensionBlock(t, service.vendor) !== null);
    return {
      service,
      present: present.length,
      supported: supported.length,
      missing: supported.filter((t) => extensionBlock(t, service.vendor) === null).length,
    };
  }).filter((a) => a.present > 0 || a.supported > 0);
}

export function unknownVendors(tokens: ParsedToken[]): string[] {
  const known = new Set(EXTENSION_SERVICES.map((s) => s.vendor));
  const out = new Set<string>();
  for (const t of tokens) {
    for (const vendor of Object.keys(t.extensions ?? {})) {
      if (!known.has(vendor)) out.add(vendor);
    }
  }
  return [...out];
}
