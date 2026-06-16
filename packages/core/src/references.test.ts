import { describe, it, expect } from 'vitest';
import { parseDocument } from './document.js';
import {
  aliasPathEquals,
  rewriteAliasReferences,
  countAliasReferences,
  renameNode,
} from './references.js';

describe('references', () => {
  it('aliasPathEquals matches both syntaxes', () => {
    expect(aliasPathEquals('{color.gray.50}', ['color', 'gray', '50'])).toBe(true);
    expect(aliasPathEquals('#/color/gray/50', ['color', 'gray', '50'])).toBe(true);
    expect(aliasPathEquals('{color.gray.900}', ['color', 'gray', '50'])).toBe(false);
    expect(aliasPathEquals('#ffffff', ['color', 'gray', '50'])).toBe(false);
  });

  it('rewrites references preserving syntax', () => {
    const data = parseDocument(
      JSON.stringify({
        color: {
          $type: 'color',
          base: { $value: '#000' },
          a: { $value: '{color.base}' },
          b: { $value: '#/color/base' },
        },
        type: {
          $type: 'typography',
          h1: { $value: { fontFamily: 'Geist', color: '{color.base}' } },
        },
      }),
    );
    const count = rewriteAliasReferences(data, ['color', 'base'], ['color', 'ink']);
    expect(count).toBe(3); // a, b, and the composite sub-property
    const d = data as any;
    expect(d.color.a.$value).toBe('{color.ink}');
    expect(d.color.b.$value).toBe('#/color/ink'); // pointer syntax preserved
    expect(d.type.h1.$value.color).toBe('{color.ink}');
  });

  it('counts references', () => {
    const data = parseDocument(
      JSON.stringify({
        c: { $type: 'color', x: { $value: '#000' }, a: { $value: '{c.x}' }, b: { $value: '{c.x}' } },
      }),
    );
    expect(countAliasReferences(data, ['c', 'x'])).toBe(2);
  });

  it('renames a node and prunes empty groups', () => {
    const data = parseDocument(
      JSON.stringify({ color: { $type: 'color', old: { $value: '#000' } } }),
    );
    expect(renameNode(data, ['color', 'old'], ['color', 'new'])).toBe(true);
    const d = data as any;
    expect(d.color.new.$value).toBe('#000');
    expect('old' in d.color).toBe(false);
  });

  it('refuses to rename onto an occupied path', () => {
    const data = parseDocument(
      JSON.stringify({ c: { $type: 'color', a: { $value: '#1' }, b: { $value: '#2' } } }),
    );
    expect(renameNode(data, ['c', 'a'], ['c', 'b'])).toBe(false);
  });

  it('renames across groups, pruning the emptied source group', () => {
    const data = parseDocument(
      JSON.stringify({ color: { $type: 'color', old: { token: { $value: '#000' } } } }),
    );
    expect(renameNode(data, ['color', 'old', 'token'], ['color', 'token'])).toBe(true);
    const d = data as any;
    expect(d.color.token.$value).toBe('#000');
    expect('old' in d.color).toBe(false); // emptied group pruned
  });
});
