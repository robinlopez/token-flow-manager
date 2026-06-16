import { describe, it, expect } from 'vitest';
import { parseFile, type RawToken } from './parser.js';
import { resolveProject, type CollectionInput } from './resolver.js';

function parseInto(name: string, json: string, modes: string[] = []): CollectionInput {
  const { tokens } = parseFile(json, {
    file: `${name}.json`,
    collection: name,
    modes,
    defaultMode: 'default',
  });
  return { name, modes, defaultMode: 'default', tokens };
}

const baseOpts = { crossCollection: true, maxAliasDepth: 10 };

describe('resolveProject — aliases', () => {
  it('resolves a curly-brace alias to its literal value', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        color: {
          $type: 'color',
          black: { $value: '#000000' },
          text: { $value: '{color.black}' },
        },
      }),
    );
    const { tokens, diagnostics } = resolveProject([col], baseOpts);
    expect(diagnostics).toHaveLength(0);
    const text = tokens.find((t) => t.path.join('.') === 'color.text')!;
    expect(text.isAlias).toBe(true);
    expect(text.resolvedValuesByMode.default).toBe('#000000');
    expect(text.aliasChainsByMode!.default).toEqual([['color', 'black']]);
  });

  it('resolves a JSON Pointer alias', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        color: {
          $type: 'color',
          black: { $value: '#000000' },
          text: { $value: '#/color/black' },
        },
      }),
    );
    const { tokens } = resolveProject([col], baseOpts);
    const text = tokens.find((t) => t.path.join('.') === 'color.text')!;
    expect(text.resolvedValuesByMode.default).toBe('#000000');
  });

  it('resolves multi-hop alias chains', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        c: {
          $type: 'color',
          a: { $value: '#111' },
          b: { $value: '{c.a}' },
          d: { $value: '{c.b}' },
        },
      }),
    );
    const { tokens } = resolveProject([col], baseOpts);
    const d = tokens.find((t) => t.path.join('.') === 'c.d')!;
    expect(d.resolvedValuesByMode.default).toBe('#111');
  });

  it('flags a broken alias with a fuzzy suggestion', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        color: { $type: 'color', primary: { $value: '#abc' }, x: { $value: '{color.primay}' } },
      }),
    );
    const { diagnostics } = resolveProject([col], baseOpts);
    const broken = diagnostics.find((d) => d.code === 'broken-alias')!;
    expect(broken).toBeDefined();
    expect(broken.message).toContain('color.primary');
  });

  it('detects a direct cycle (A -> B -> A)', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        c: { $type: 'color', a: { $value: '{c.b}' }, b: { $value: '{c.a}' } },
      }),
    );
    const { diagnostics } = resolveProject([col], baseOpts);
    expect(diagnostics.some((d) => d.code === 'alias-cycle')).toBe(true);
  });

  it('flags a type mismatch when a color aliases a dimension', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        size: { $type: 'dimension', sm: { $value: '4px' } },
        color: { $type: 'color', bad: { $value: '{size.sm}' } },
      }),
    );
    const { diagnostics } = resolveProject([col], baseOpts);
    expect(diagnostics.some((d) => d.code === 'alias-type-mismatch')).toBe(true);
  });

  it('resolves per-mode independently', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        color: {
          $type: 'color',
          base: { $value: { light: '#fff', dark: '#000' } },
          surface: { $value: '{color.base}' },
        },
      }),
      ['light', 'dark'],
    );
    const { tokens } = resolveProject([col], baseOpts);
    const surface = tokens.find((t) => t.path.join('.') === 'color.surface')!;
    expect(surface.resolvedValuesByMode.light).toBe('#fff');
    expect(surface.resolvedValuesByMode.dark).toBe('#000');
  });
});

describe('resolveProject — cross-collection', () => {
  const tokensCol = () =>
    parseInto('Tokens', JSON.stringify({ color: { $type: 'color', black: { $value: '#000' } } }));
  const semanticCol = (value: string) =>
    parseInto('Semantic', JSON.stringify({ text: { $type: 'color', body: { $value: value } } }));

  it('allows a later collection to reference an earlier one', () => {
    const { tokens, diagnostics } = resolveProject(
      [tokensCol(), semanticCol('{color.black}')],
      { ...baseOpts, order: ['Tokens', 'Semantic'] },
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const body = tokens.find((t) => t.collection === 'Semantic')!;
    expect(body.resolvedValuesByMode.default).toBe('#000');
  });

  it('warns (but still resolves) when referencing a later collection', () => {
    // Tokens references Semantic — unusual given the order, but should resolve.
    const tokens = parseInto(
      'Tokens',
      JSON.stringify({ color: { $type: 'color', x: { $value: '{text.body}' } } }),
    );
    const semantic = parseInto(
      'Semantic',
      JSON.stringify({ text: { $type: 'color', body: { $value: '#000' } } }),
    );
    const { tokens: resolved, diagnostics } = resolveProject([tokens, semantic], {
      ...baseOpts,
      order: ['Tokens', 'Semantic'],
    });
    const order = diagnostics.find((d) => d.code === 'cross-collection-order');
    expect(order?.severity).toBe('warning'); // soft, not blocking
    // the value still resolves across the boundary
    const x = resolved.find((t) => t.path.join('.') === 'color.x')!;
    expect(x.resolvedValuesByMode.default).toBe('#000');
  });
});

describe('resolveProject — composite sub-property aliases', () => {
  it('resolves alias sub-properties inside a typography token', () => {
    const col = parseInto(
      'Tokens',
      JSON.stringify({
        font: { weight: { $type: 'fontWeight', bold: { $value: 700 } } },
        heading: {
          $type: 'typography',
          lg: {
            $value: { fontFamily: 'Geist', fontWeight: '{font.weight.bold}', fontSize: '2rem' },
          },
        },
      }),
    );
    const { tokens } = resolveProject([col], baseOpts);
    const heading = tokens.find((t) => t.path.join('.') === 'heading.lg')!;
    const resolved = heading.resolvedValuesByMode.default as Record<string, unknown>;
    expect(resolved.fontWeight).toBe(700);
    expect(resolved.fontFamily).toBe('Geist');
  });
});

describe('resolveProject — collection-namespace aliases (PrimeNG convention)', () => {
  it('resolves {primitive.green.500} to green.500 in the "primitives" collection', () => {
    const primitives = parseInto(
      'primitives',
      JSON.stringify({ green: { $type: 'color', '500': { $value: '#22c55e' } } }),
    );
    const semantics = parseInto(
      'semantics',
      JSON.stringify({ action: { $type: 'color', success: { $value: '{primitive.green.500}' } } }),
    );
    const { tokens, diagnostics } = resolveProject([primitives, semantics], {
      ...baseOpts,
      order: ['primitives', 'semantics'],
    });
    const sem = tokens.find((t) => t.path.join('.') === 'action.success')!;
    expect(diagnostics.filter((d) => d.code === 'broken-alias')).toHaveLength(0);
    expect(sem.isAlias).toBe(true);
    expect(sem.resolvedValuesByMode.default).toBe('#22c55e');
  });

  it('still flags a genuinely missing namespaced alias as broken', () => {
    const primitives = parseInto(
      'primitives',
      JSON.stringify({ green: { $type: 'color', '500': { $value: '#22c55e' } } }),
    );
    const semantics = parseInto(
      'semantics',
      JSON.stringify({ x: { $type: 'color', $value: '{primitive.green.999}' } }),
    );
    const { diagnostics } = resolveProject([primitives, semantics], {
      ...baseOpts,
      order: ['primitives', 'semantics'],
    });
    expect(diagnostics.some((d) => d.code === 'broken-alias')).toBe(true);
  });
});

describe('resolveProject — incomplete mode overrides', () => {
  const src = { file: 'c.json', line: 0, column: 0 };
  const mk = (path: string[], rawValuesByMode: Record<string, unknown>): RawToken => ({
    path,
    collection: 'c',
    group: path[0]!,
    type: 'color',
    rawValuesByMode,
    source: src,
  });

  it('warns when a token defines some but not all modes', () => {
    const col: CollectionInput = {
      name: 'c',
      modes: ['light', 'dark'],
      defaultMode: 'light',
      tokens: [
        mk(['color', 'bg'], { light: '#fff', dark: '#000' }), // complete → no warning
        mk(['color', 'fg'], { light: '#111' }), // missing dark → warning
      ],
    };
    const { diagnostics } = resolveProject([col], baseOpts);
    const inc = diagnostics.filter((d) => d.code === 'incomplete-mode-override');
    expect(inc).toHaveLength(1);
    expect(inc[0]!.severity).toBe('warning');
    expect(inc[0]!.message).toContain('color.fg');
    expect(inc[0]!.message).toContain('dark');
  });

  it('does not warn for single-mode collections', () => {
    const col: CollectionInput = {
      name: 'c',
      modes: [],
      defaultMode: 'default',
      tokens: [mk(['color', 'bg'], { default: '#fff' })],
    };
    const { diagnostics } = resolveProject([col], baseOpts);
    expect(diagnostics.some((d) => d.code === 'incomplete-mode-override')).toBe(false);
  });
});
