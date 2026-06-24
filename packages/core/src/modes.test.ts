import { describe, it, expect } from 'vitest';
import { parseFile } from './parser.js';
import {
  detectModeDimension,
  isModeSegment,
  mergeByModeDimension,
  mergeByPath,
} from './modes.js';
import { resolveProject } from './resolver.js';

const parse = (json: string) =>
  parseFile(json, { file: 'f.json', collection: 'semantics', modes: [], defaultMode: 'default' }).tokens;

describe('mode dimension', () => {
  it('recognises mode-like segments', () => {
    expect(isModeSegment('modeLight')).toBe(true);
    expect(isModeSegment('modeDark')).toBe(true);
    expect(isModeSegment('dark')).toBe(true);
    expect(isModeSegment('surface')).toBe(false);
    expect(isModeSegment('monospace')).toBe(false);
  });

  it('detects the depth where every segment is a mode (PrimeNG style)', () => {
    const tokens = parse(
      JSON.stringify({
        $type: 'design-token',
        token: {
          modeLight: { surface: { $value: '#fff' }, text: { $value: '#000' } },
          modeDark: { surface: { $value: '#000' }, text: { $value: '#fff' } },
        },
      }),
    );
    const dim = detectModeDimension(tokens.map((t) => t.path));
    expect(dim).toEqual({ dimension: 1, modes: ['modeDark', 'modeLight'] });
  });

  it('does not flag ordinary group levels as a mode dimension', () => {
    const tokens = parse(
      JSON.stringify({ color: { $type: 'color', primary: { $value: '#abc' }, secondary: { $value: '#def' } } }),
    );
    expect(detectModeDimension(tokens.map((t) => t.path))).toBeUndefined();
  });

  it('merges tokens along the mode dimension into multi-mode tokens', () => {
    const tokens = parse(
      JSON.stringify({
        $type: 'design-token',
        token: {
          modeLight: { surface: { $value: '#fff' } },
          modeDark: { surface: { $value: '#000' } },
        },
      }),
    );
    const dim = detectModeDimension(tokens.map((t) => t.path))!;
    const merged = mergeByModeDimension(tokens, dim, 'default');
    expect(merged).toHaveLength(1);
    expect(merged[0]!.path).toEqual(['token', 'surface']);
    expect(merged[0]!.rawValuesByMode).toEqual({ modeLight: '#fff', modeDark: '#000' });
  });

  it('merges same-path tokens from different files into multi-mode (file modes)', () => {
    const one = parseFile(JSON.stringify({ primary: { '500': { $value: '#aaa' } } }), {
      file: 'themeOne.json',
      collection: 'primitives',
      modes: [],
      defaultMode: 'themeOne',
    }).tokens;
    const two = parseFile(JSON.stringify({ primary: { '500': { $value: '#bbb' } } }), {
      file: 'themeTwo.json',
      collection: 'primitives',
      modes: [],
      defaultMode: 'themeTwo',
    }).tokens;
    const merged = mergeByPath([...one, ...two]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.path).toEqual(['primary', '500']);
    expect(merged[0]!.rawValuesByMode).toEqual({ themeOne: '#aaa', themeTwo: '#bbb' });
  });

  it('resolves merged multi-mode tokens per mode', () => {
    const tokens = parse(
      JSON.stringify({
        $type: 'design-token',
        token: {
          modeLight: { surface: { $value: '#fff' } },
          modeDark: { surface: { $value: '#000' } },
        },
      }),
    );
    const dim = detectModeDimension(tokens.map((t) => t.path))!;
    const merged = mergeByModeDimension(tokens, dim, 'default');
    const { tokens: resolved } = resolveProject(
      [{ name: 'semantics', modes: dim.modes, defaultMode: dim.modes[0]!, tokens: merged }],
      { crossCollection: true, maxAliasDepth: 10 },
    );
    expect(resolved[0]!.resolvedValuesByMode).toEqual({ modeLight: '#fff', modeDark: '#000' });
  });
});
