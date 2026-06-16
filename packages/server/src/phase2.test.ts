import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type TokenflowConfig } from '@tokenflow/shared';
import { ProjectManager } from './project.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-p2-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const SAMPLE = JSON.stringify(
  {
    color: {
      $type: 'color',
      gray: { '50': { $value: '#fafafa' }, '900': { $value: '#1c1917' } },
      brand: { primary: { $value: '{color.gray.900}' } },
      surface: { default: { $value: '{color.gray.900}' } },
    },
  },
  null,
  2,
);

async function loaded(): Promise<ProjectManager> {
  await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
  const pm = new ProjectManager(root, DEFAULT_CONFIG);
  await pm.load();
  return pm;
}

const find = (pm: ProjectManager, path: string) =>
  pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === path)!;

describe('rename-safe propagation', () => {
  it('lists incoming references', async () => {
    const pm = await loaded();
    const gray900 = find(pm, 'color.gray.900');
    const refs = pm.getReferences(gray900.id);
    const paths = refs.map((r) => r.path.join('.')).sort();
    expect(paths).toEqual(['color.brand.primary', 'color.surface.default']);
    await pm.dispose();
  });

  it('previews rename impact', async () => {
    const pm = await loaded();
    const gray900 = find(pm, 'color.gray.900');
    const preview = pm.renamePreview(gray900.id, ['color', 'gray', 'ink']);
    expect(preview.references).toBe(2);
    expect(preview.conflict).toBe(false);
    await pm.dispose();
  });

  it('renames a token and rewrites all references on disk', async () => {
    const pm = await loaded();
    const gray900 = find(pm, 'color.gray.900');
    const result = await pm.renameToken(gray900.id, ['color', 'gray', 'ink'], true);
    expect(result.ok).toBe(true);

    const disk = JSON.parse(await readFile(join(root, 'app.tokens.json'), 'utf8'));
    expect(disk.color.gray.ink.$value).toBe('#1c1917');
    expect('900' in disk.color.gray).toBe(false);
    expect(disk.color.brand.primary.$value).toBe('{color.gray.ink}');
    expect(disk.color.surface.default.$value).toBe('{color.gray.ink}');

    // Aliases still resolve after rename.
    const primary = find(pm, 'color.brand.primary');
    expect(primary.resolvedValuesByMode.default).toBe('#1c1917');
    await pm.dispose();
  });

  it('rejects renaming onto an existing path', async () => {
    const pm = await loaded();
    const gray900 = find(pm, 'color.gray.900');
    const result = await pm.renameToken(gray900.id, ['color', 'gray', '50'], true);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('duplicate-token');
    await pm.dispose();
  });
});

describe('search + filters', () => {
  it('full-text searches by name', async () => {
    const pm = await loaded();
    const res = pm.search('primary');
    expect(res.hits.some((h) => h.path.join('.') === 'color.brand.primary')).toBe(true);
    await pm.dispose();
  });

  it('filters alias-only', async () => {
    const pm = await loaded();
    const res = pm.search('', { alias: 'only' });
    const paths = res.hits.map((h) => h.path.join('.')).sort();
    expect(paths).toEqual(['color.brand.primary', 'color.surface.default']);
    await pm.dispose();
  });

  it('filters non-alias only', async () => {
    const pm = await loaded();
    const aliasPaths = pm
      .search('', { alias: 'only' })
      .hits.map((h) => h.path.join('.'));
    const res = pm.search('', { alias: 'none' });
    const paths = res.hits.map((h) => h.path.join('.'));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => aliasPaths.includes(p))).toBe(false);
    await pm.dispose();
  });

  it('filters orphans (no incoming references)', async () => {
    const pm = await loaded();
    const res = pm.search('', { orphans: true });
    const paths = res.hits.map((h) => h.path.join('.'));
    // gray.900 is referenced -> not an orphan; gray.50 + the two aliases are orphans.
    expect(paths).toContain('color.gray.50');
    expect(paths).not.toContain('color.gray.900');
    await pm.dispose();
  });
});

describe('reorder', () => {
  it('reorders a group\'s direct children on disk', async () => {
    await writeFile(
      join(root, 'app.tokens.json'),
      JSON.stringify(
        {
          space: {
            $type: 'dimension',
            sm: { $value: '4px' },
            md: { $value: '8px' },
            lg: { $value: '16px' },
          },
        },
        null,
        2,
      ) + '\n',
    );
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    // Non-numeric keys preserve insertion order (numeric keys are JSON-sorted).
    const result = await pm.reorderTokens('Tokens', ['space'], ['lg', 'sm', 'md']);
    expect(result.ok).toBe(true);
    const disk = JSON.parse(await readFile(join(root, 'app.tokens.json'), 'utf8'));
    expect(Object.keys(disk.space)).toEqual(['$type', 'lg', 'sm', 'md']);
    await pm.dispose();
  });
});

describe('moveGroup (re-nesting)', () => {
  it('moves a whole group under a new parent, rewriting references', async () => {
    await writeFile(
      join(root, 'app.tokens.json'),
      JSON.stringify(
        {
          color: {
            $type: 'color',
            brand: { primary: { $value: '#abc' }, accent: { $value: '#def' } },
          },
          alias: { $type: 'color', x: { $value: '{color.brand.primary}' } },
        },
        null,
        2,
      ) + '\n',
    );
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    // Move group color.brand → under "palette" (root) i.e. palette.brand.*
    const result = await pm.moveGroup('Tokens', ['color', 'brand'], ['palette']);
    expect(result.ok).toBe(true);

    const disk = JSON.parse(await readFile(join(root, 'app.tokens.json'), 'utf8'));
    expect(disk.palette.brand.primary.$value).toBe('#abc');
    expect(disk.palette.brand.accent.$value).toBe('#def');
    // color held only `brand`, so the emptied group is pruned.
    expect(disk.color).toBeUndefined();
    // incoming reference rewritten to the new path
    expect(disk.alias.x.$value).toBe('{palette.brand.primary}');
    await pm.dispose();
  });

  it('refuses to move a group into itself', async () => {
    await writeFile(
      join(root, 'app.tokens.json'),
      JSON.stringify({ a: { $type: 'color', b: { c: { $value: '#000' } } } }, null, 2) + '\n',
    );
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const result = await pm.moveGroup('Tokens', ['a'], ['a', 'b']);
    expect(result.ok).toBe(false);
    await pm.dispose();
  });
});

describe('quick-fix', () => {
  it('replaces a broken alias via its quick-fix', async () => {
    await writeFile(
      join(root, 'app.tokens.json'),
      JSON.stringify(
        { color: { $type: 'color', primary: { $value: '#abc' }, x: { $value: '{color.primay}' } } },
        null,
        2,
      ) + '\n',
    );
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const broken = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.x')!;
    const diag = broken.diagnostics.find((d) => d.code === 'broken-alias')!;
    const fix = diag.quickFixes![0]!;
    expect(fix.action).toBe('replace-alias');

    const result = await pm.applyQuickFix(broken.id, fix.action, diag.mode, fix.data);
    expect(result.ok).toBe(true);
    const fixed = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.x')!;
    expect(fixed.diagnostics.length).toBe(0);
    expect(fixed.resolvedValuesByMode.default).toBe('#abc');
    await pm.dispose();
  });
});
