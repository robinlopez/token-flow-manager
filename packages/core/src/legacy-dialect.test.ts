import { describe, it, expect } from 'vitest';
import {
  documentDialect,
  envelopeOf,
  extractEmbeddedRefs,
  isExpression,
  scanDialect,
} from '@tokenflow/shared';
import { parseFile } from './parser.js';
import {
  detectFormat,
  makeTokenNode,
  parseDocument,
  renameInlineMode,
  setTokenDescription,
  setTokenValue,
  stringifyDocument,
} from './document.js';
import { countAliasReferences, rewriteAliasReferences } from './references.js';
import { validateValue } from './validator.js';

const opts = (overrides = {}) => ({
  file: 'core.tw.figmaTokens.json',
  collection: 'Tokens',
  modes: [] as string[],
  defaultMode: 'default',
  ...overrides,
});

/** Shaped like a real Tokens Studio export, including a nested shadow `type`. */
const LEGACY = {
  colors: {
    white: { value: '#ffffff', type: 'color' },
    'default-gray': { 50: { value: '{colors.white}', type: 'color' } },
  },
  boxShadow: {
    'shadow-sm': {
      value: { color: '#0000000d', type: 'dropShadow', x: '0', y: '1', blur: '2', spread: '0' },
      type: 'boxShadow',
    },
  },
  fontFamily: { sans: { value: 'SF Pro, sans-serif', type: 'fontFamilies' } },
  fontSize: {
    base: { value: '16', type: 'fontSizes' },
    xs: { value: '{fontSize.base} * 0.75', type: 'fontSizes' },
  },
  lineHeight: { normal: { value: '150%', type: 'lineHeights' } },
  sizing: { md: { value: '{spacing.4}', type: 'sizing' } },
  spacing: { 4: { value: '16', type: 'spacing' } },
  textTransform: { none: { value: 'none', type: 'textCase' } },
};

describe('legacy Tokens Studio dialect: reading', () => {
  it('reads tokens written with `value`/`type`', () => {
    const { tokens } = parseFile(JSON.stringify(LEGACY), opts());
    const byPath = Object.fromEntries(tokens.map((t) => [t.path.join('.'), t]));
    expect(tokens).toHaveLength(10);
    expect(byPath['colors.white']!.type).toBe('color');
    expect(byPath['colors.white']!.rawValuesByMode.default).toBe('#ffffff');
  });

  it('never descends into a payload, so a nested `type` is not a token', () => {
    const { tokens } = parseFile(JSON.stringify(LEGACY), opts());
    const shadow = tokens.find((t) => t.path.join('.') === 'boxShadow.shadow-sm')!;
    expect(shadow.type).toBe('shadow');
    // The payload is handed over verbatim, `dropShadow` marker included.
    expect(shadow.rawValuesByMode.default).toEqual({
      color: '#0000000d',
      type: 'dropShadow',
      x: '0',
      y: '1',
      blur: '2',
      spread: '0',
    });
    expect(tokens.some((t) => t.path.includes('value'))).toBe(false);
  });

  it('maps legacy type names instead of guessing from the value', () => {
    const { tokens } = parseFile(JSON.stringify(LEGACY), opts());
    const type = (p: string) => tokens.find((t) => t.path.join('.') === p)!.type;
    expect(type('fontFamily.sans')).toBe('fontFamily');
    expect(type('lineHeight.normal')).toBe('number');
    // Inference alone would leave these two untyped: one is an alias, the other
    // an expression. Both belong to a group whose siblings are plain numbers.
    expect(type('sizing.md')).toBe('dimension');
    expect(type('fontSize.xs')).toBe('dimension');
    // No DTCG equivalent: stays generic rather than being force-fit.
    expect(type('textTransform.none')).toBe('unknown');
  });

  it('records the original type name for traceability', () => {
    const { tokens } = parseFile(JSON.stringify(LEGACY), opts());
    const shadow = tokens.find((t) => t.path.join('.') === 'boxShadow.shadow-sm')!;
    expect(shadow.extensions?.['com.tokenflow.sourceType']).toBe('boxShadow');
  });

  it('reports the dialect instead of loading an empty, silent collection', () => {
    const { diagnostics } = parseFile(JSON.stringify(LEGACY), opts());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('legacy-format');
    expect(diagnostics[0]!.severity).toBe('info');
    expect(diagnostics[0]!.file).toBe('core.tw.figmaTokens.json');
  });

  it('warns on a file mixing both dialects, and reads both', () => {
    const json = JSON.stringify({
      a: { value: '#fff', type: 'color' },
      b: { $value: '#000', $type: 'color' },
    });
    const { tokens, diagnostics } = parseFile(json, opts());
    expect(tokens).toHaveLength(2);
    expect(diagnostics[0]!.code).toBe('legacy-format');
    expect(diagnostics[0]!.severity).toBe('warning');
  });

  it('reads a legacy `description`', () => {
    const json = JSON.stringify({ a: { value: '#fff', type: 'color', description: 'Base' } });
    const { tokens } = parseFile(json, opts());
    expect(tokens[0]!.description).toBe('Base');
  });

  it('leaves a pure DTCG file untouched (no diagnostic, no misreading)', () => {
    // The payload holds a `value` key of its own: it must not be mistaken for
    // a legacy envelope.
    const json = JSON.stringify({ space: { sm: { $value: { value: 16, unit: 'px' }, $type: 'dimension' } } });
    const { tokens, diagnostics } = parseFile(json, opts());
    expect(diagnostics).toHaveLength(0);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.rawValuesByMode.default).toEqual({ value: 16, unit: 'px' });
  });

  it('tells a legacy token from a group whose child is named "value"', () => {
    const group = { value: { value: '#fff', type: 'color' } };
    expect(envelopeOf(group)).toBeNull();
    const { tokens } = parseFile(JSON.stringify({ weird: group }), opts());
    expect(tokens.map((t) => t.path.join('.'))).toEqual(['weird.value']);
  });

  it('scans and summarises a document dialect', () => {
    expect(scanDialect(LEGACY)).toEqual({ dialect: 'legacy', dtcg: 0, legacy: 10 });
    expect(documentDialect(LEGACY)).toBe('legacy');
    expect(documentDialect({ a: { $value: 1 } })).toBe('dtcg');
    expect(documentDialect({})).toBe('dtcg'); // empty file: new tokens go DTCG
  });
});

describe('legacy Tokens Studio dialect: writing', () => {
  const text = JSON.stringify(LEGACY, null, 2) + '\n';

  it('round-trips: editing one value rewrites that value and nothing else', () => {
    const data = parseDocument(text);
    expect(setTokenValue(data, ['colors', 'white'], 'default', '#eeeeee')).toBe(true);
    const out = stringifyDocument(data, detectFormat(text));

    expect(out).toBe(text.replace('"value": "#ffffff"', '"value": "#eeeeee"'));
    expect(out).not.toContain('$value');
  });

  it('writes a description under the key the file already uses', () => {
    const data = parseDocument(text);
    expect(setTokenDescription(data, ['colors', 'white'], 'Base white')).toBe(true);
    const node = (data['colors'] as Record<string, Record<string, unknown>>)['white']!;
    expect(node['description']).toBe('Base white');
    expect(node).not.toHaveProperty('$description');
  });

  it('creates a node in the file dialect, with the name Tokens Studio expects', () => {
    expect(makeTokenNode('legacy', { type: 'shadow', value: { x: '0' } })).toEqual({
      type: 'boxShadow',
      value: { x: '0' },
    });
    expect(makeTokenNode('dtcg', { type: 'shadow', value: { x: '0' }, description: 'd' })).toEqual({
      $type: 'shadow',
      $description: 'd',
      $value: { x: '0' },
    });
  });

  it('renames an inline mode inside a legacy value', () => {
    const data = parseDocument(
      JSON.stringify({ bg: { value: { light: '#fff', dark: '#000' }, type: 'color' } }),
    );
    expect(renameInlineMode(data, 'light', 'day')).toBe(1);
    expect((data['bg'] as Record<string, unknown>)['value']).toEqual({ day: '#fff', dark: '#000' });
  });
});

describe('Tokens Studio expressions', () => {
  it('recognises expressions without mistaking plain values for them', () => {
    expect(isExpression('{fontSize.base} * 0.75')).toBe(true);
    expect(isExpression('16 * 1.5')).toBe(true);
    expect(isExpression('{colors.gray.50}')).toBe(false); // plain alias
    expect(isExpression('-4')).toBe(false);
    expect(isExpression('-4px')).toBe(false);
    expect(isExpression('16')).toBe(false);
    expect(isExpression('SF Pro, sans-serif')).toBe(false);
  });

  it('is accepted by validation rather than flagged as a broken value', () => {
    expect(validateValue('{fontSize.base} * 0.75', 'dimension')).toBeNull();
    expect(validateValue('150%', 'number')).toBeNull(); // Tokens Studio line height
    expect(validateValue('nonsense', 'dimension')).not.toBeNull(); // still validated
  });

  it('exposes the references embedded in an expression', () => {
    expect(extractEmbeddedRefs('{fontSize.base} * 0.75')).toEqual([['fontSize', 'base']]);
    expect(extractEmbeddedRefs('{a.b} + {c.d}')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(extractEmbeddedRefs('{a.b}')).toEqual([]); // plain alias, handled elsewhere
  });

  it('counts and rewrites references inside expressions on rename', () => {
    const data = parseDocument(JSON.stringify(LEGACY));
    expect(countAliasReferences(data, ['fontSize', 'base'])).toBe(1);
    expect(rewriteAliasReferences(data, ['fontSize', 'base'], ['fontSize', 'root'])).toBe(1);
    const fontSize = data['fontSize'] as Record<string, Record<string, unknown>>;
    expect(fontSize['xs']!['value']).toBe('{fontSize.root} * 0.75');
  });

  it('rewrites a plain alias and an expression in the same pass', () => {
    const data = parseDocument(
      JSON.stringify({
        a: { value: '{spacing.4}', type: 'sizing' },
        b: { value: '{spacing.4} * 2', type: 'sizing' },
      }),
    );
    expect(rewriteAliasReferences(data, ['spacing', '4'], ['spacing', 'md'])).toBe(2);
    expect((data['a'] as Record<string, unknown>)['value']).toBe('{spacing.md}');
    expect((data['b'] as Record<string, unknown>)['value']).toBe('{spacing.md} * 2');
  });
});
