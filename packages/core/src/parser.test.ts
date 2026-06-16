import { describe, it, expect } from 'vitest';
import { parseFile } from './parser.js';

const opts = (overrides = {}) => ({
  file: 'tokens.json',
  collection: 'Tokens',
  modes: [] as string[],
  defaultMode: 'default',
  ...overrides,
});

describe('parseFile', () => {
  it('parses scalar tokens with $type inheritance from groups', () => {
    const json = JSON.stringify({
      color: {
        $type: 'color',
        brand: { primary: { $value: '#ff0000' } },
        white: { $value: '#ffffff' },
      },
    });
    const { tokens, diagnostics } = parseFile(json, opts());
    expect(diagnostics).toHaveLength(0);
    expect(tokens).toHaveLength(2);
    const primary = tokens.find((t) => t.path.join('.') === 'color.brand.primary')!;
    expect(primary.type).toBe('color');
    expect(primary.group).toBe('color');
    expect(primary.rawValuesByMode.default).toBe('#ff0000');
  });

  it('captures source line/column for each token', () => {
    const json = '{\n  "space": {\n    "sm": { "$type": "dimension", "$value": "4px" }\n  }\n}';
    const { tokens } = parseFile(json, opts());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.source.line).toBe(2); // 0-based line of "sm"
    expect(tokens[0]!.source.file).toBe('tokens.json');
  });

  it('emits missing-type only in strict mode', () => {
    const json = JSON.stringify({ orphan: { $value: 'ease-in' } });
    const strict = parseFile(json, opts({ strictTypes: true, inferTypes: false }));
    expect(strict.tokens).toHaveLength(0);
    expect(strict.diagnostics[0]!.code).toBe('missing-type');
  });

  it('tolerant mode keeps untyped tokens and infers from value', () => {
    const json = JSON.stringify({
      $type: 'design-token',
      transition: { fast: { $value: '80ms' }, easing: { $value: 'ease-in' } },
      space: { sm: { $value: '4px' } },
      brand: { $value: '#ff0000' },
    });
    const { tokens, diagnostics } = parseFile(json, opts());
    expect(diagnostics).toHaveLength(0); // no unknown-type / missing-type noise
    const byPath = Object.fromEntries(tokens.map((t) => [t.path.join('.'), t.type]));
    expect(byPath['transition.fast']).toBe('duration');
    expect(byPath['space.sm']).toBe('dimension');
    expect(byPath['brand']).toBe('color');
    expect(byPath['transition.easing']).toBe('unknown'); // not inferable, kept generic
  });

  it('reports a JSON parse error instead of throwing', () => {
    const { tokens, diagnostics } = parseFile('{ not json', opts());
    expect(tokens).toHaveLength(0);
    expect(diagnostics[0]!.code).toBe('json-parse-error');
  });

  it('detects unresolved merge conflict markers', () => {
    const json = '{\n<<<<<<< HEAD\n  "a": 1\n=======\n  "a": 2\n>>>>>>> branch\n}';
    const { diagnostics } = parseFile(json, opts());
    expect(diagnostics[0]!.code).toBe('merge-conflict');
  });

  it('splits inline-mode values across declared modes', () => {
    const json = JSON.stringify({
      bg: { $type: 'color', $value: { light: '#fff', dark: '#000' } },
    });
    const { tokens } = parseFile(json, opts({ modes: ['light', 'dark'] }));
    expect(tokens[0]!.rawValuesByMode).toEqual({ light: '#fff', dark: '#000' });
  });

  it('applies a single value to every declared mode when not split', () => {
    const json = JSON.stringify({ bg: { $type: 'color', $value: '#fff' } });
    const { tokens } = parseFile(json, opts({ modes: ['light', 'dark'] }));
    expect(tokens[0]!.rawValuesByMode).toEqual({ light: '#fff', dark: '#fff' });
  });
});
