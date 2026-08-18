import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  parseDocument,
  stringifyDocument,
  setTokenValue,
  deleteTokenNode,
  reorderChildren,
  setTokenExtension,
} from './document.js';

describe('document — format-preserving mutation', () => {
  it('preserves key order and indentation on round-trip + edit', () => {
    const content = [
      '{',
      '  "color": {',
      '    "$type": "color",',
      '    "primary": { "$value": "#ff0000" },',
      '    "secondary": { "$value": "#00ff00" }',
      '  }',
      '}',
      '',
    ].join('\n');

    const fmt = detectFormat(content);
    expect(fmt.indent).toBe('  ');
    expect(fmt.trailingNewline).toBe(true);

    const data = parseDocument(content);
    const ok = setTokenValue(data, ['color', 'primary'], 'default', '#0000ff');
    expect(ok).toBe(true);

    const out = stringifyDocument(data, fmt);
    // Order preserved: primary still before secondary.
    expect(out.indexOf('primary')).toBeLessThan(out.indexOf('secondary'));
    expect(out).toContain('#0000ff');
    expect(out.endsWith('}\n')).toBe(true);
    // Re-parse confirms the edit landed.
    const reparsed = parseDocument(out) as Record<string, any>;
    expect(reparsed.color.primary.$value).toBe('#0000ff');
  });

  it('detects tab indentation', () => {
    const content = '{\n\t"a": {\n\t\t"$value": 1\n\t}\n}';
    expect(detectFormat(content).indent).toBe('\t');
  });

  it('updates only one mode for inline-mode values', () => {
    const data = parseDocument(
      JSON.stringify({ bg: { $type: 'color', $value: { light: '#fff', dark: '#000' } } }),
    );
    setTokenValue(data, ['bg'], 'dark', '#111', { inlineMode: true });
    const value = (data as any).bg.$value;
    expect(value).toEqual({ light: '#fff', dark: '#111' });
  });

  it('reorders group children, keeping $meta first', () => {
    const data = parseDocument(
      JSON.stringify({
        spacing: {
          $type: 'dimension',
          sm: { $value: '4px' },
          md: { $value: '8px' },
          lg: { $value: '16px' },
        },
      }),
    );
    expect(reorderChildren(data, ['spacing'], ['lg', 'sm', 'md'])).toBe(true);
    const keys = Object.keys((data as any).spacing);
    expect(keys).toEqual(['$type', 'lg', 'sm', 'md']);
  });

  it('deletes a token node', () => {
    const data = parseDocument(JSON.stringify({ a: { $value: 1 }, b: { $value: 2 } }));
    expect(deleteTokenNode(data, ['a'])).toBe(true);
    expect('a' in data).toBe(false);
    expect('b' in data).toBe(true);
  });
});

describe('document — vendor extensions', () => {
  const node = () => ({
    radius: {
      sm: {
        $type: 'dimension',
        $value: '4px',
        $extensions: {
          'com.figma': {
            variableId: 'VariableID:1:2',
            collectionId: 'VariableCollectionId:1:0',
            modeId: '1:5',
            resolvedType: 'FLOAT',
            scopes: ['CORNER_RADIUS'],
          },
        },
      },
    },
  });

  it('merges only the patched keys, leaving binding identities intact', () => {
    const data = parseDocument(JSON.stringify(node()));
    expect(setTokenExtension(data, ['radius', 'sm'], 'com.figma', { scopes: ['WIDTH_HEIGHT'] })).toBe(true);
    const block = (data as any).radius.sm.$extensions['com.figma'];
    expect(block).toEqual({
      variableId: 'VariableID:1:2',
      collectionId: 'VariableCollectionId:1:0',
      modeId: '1:5',
      resolvedType: 'FLOAT',
      scopes: ['WIDTH_HEIGHT'],
    });
    expect(Object.keys(block)).toEqual([
      'variableId',
      'collectionId',
      'modeId',
      'resolvedType',
      'scopes',
    ]);
  });

  it('creates the block (and $extensions) when the token has none', () => {
    const data = parseDocument(JSON.stringify({ gap: { $type: 'dimension', $value: '8px' } }));
    setTokenExtension(data, ['gap'], 'com.figma', { scopes: ['GAP'], resolvedType: 'FLOAT' });
    expect((data as any).gap.$extensions).toEqual({
      'com.figma': { scopes: ['GAP'], resolvedType: 'FLOAT' },
    });
  });

  it('deletes a field on a null patch value', () => {
    const data = parseDocument(JSON.stringify(node()));
    setTokenExtension(data, ['radius', 'sm'], 'com.figma', { scopes: null });
    expect((data as any).radius.sm.$extensions['com.figma'].scopes).toBeUndefined();
    expect((data as any).radius.sm.$extensions['com.figma'].modeId).toBe('1:5');
  });

  it('removes the vendor block, then $extensions once empty', () => {
    const data = parseDocument(JSON.stringify(node()));
    setTokenExtension(data, ['radius', 'sm'], 'com.figma', null);
    expect((data as any).radius.sm.$extensions).toBeUndefined();
  });

  it('leaves other vendors alone', () => {
    const data = parseDocument(
      JSON.stringify({
        a: { $value: 1, $extensions: { 'com.figma': { scopes: [] }, 'com.acme': { x: 1 } } },
      }),
    );
    setTokenExtension(data, ['a'], 'com.figma', null);
    expect((data as any).a.$extensions).toEqual({ 'com.acme': { x: 1 } });
  });

  it('returns false for a missing token node', () => {
    const data = parseDocument(JSON.stringify({ a: { $value: 1 } }));
    expect(setTokenExtension(data, ['nope'], 'com.figma', { scopes: [] })).toBe(false);
  });
});
