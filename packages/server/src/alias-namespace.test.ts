import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenflowConfig } from '@tokenflow/shared';
import { ProjectManager } from './project.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-ns-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const CONFIG: TokenflowConfig = {
  collections: [
    { name: 'primitives', files: ['primitives.json'] },
    { name: 'semantics', files: ['semantics.json'] },
  ],
  resolution: { crossCollection: true, maxAliasDepth: 10, order: ['primitives', 'semantics'] },
  writeDebounceMs: 0,
  strictTypes: false,
  inferTypes: true,
};

const PRIMITIVES = {
  red: { $type: 'color', '100': { $value: '#fee2e2' }, '200': { $value: '#fecaca' } },
  slate: { $type: 'color', '600': { $value: '#475569' } },
};

/**
 * `semantics` references `primitives` through the collection-namespace
 * convention, the form the downstream build (Style Dictionary) expects.
 */
const SEMANTICS_NAMESPACED = {
  actions: { $type: 'color', hover: { $value: '{primitives.red.100}' } },
};

/** The same project, but referencing the bare path. */
const SEMANTICS_BARE = {
  actions: { $type: 'color', hover: { $value: '{red.100}' } },
};

async function loaded(semantics: unknown): Promise<ProjectManager> {
  await writeFile(join(root, 'primitives.json'), JSON.stringify(PRIMITIVES, null, 2) + '\n');
  await writeFile(join(root, 'semantics.json'), JSON.stringify(semantics, null, 2) + '\n');
  const pm = new ProjectManager(root, CONFIG);
  await pm.load();
  return pm;
}

const find = (pm: ProjectManager, collection: string, path: string) =>
  pm.getCollection(collection)!.tokens.find((t) => t.path.join('.') === path)!;

const disk = async (file: string) =>
  JSON.parse(await readFile(join(root, file), 'utf8')) as Record<string, never>;

describe('collection-namespaced aliases', () => {
  it('keeps the project convention when re-linking a cross-collection alias', async () => {
    const pm = await loaded(SEMANTICS_NAMESPACED);
    const hover = find(pm, 'semantics', 'actions.hover');

    // The picker hands over the target's bare path; it must land namespaced.
    const res = await pm.updateValue(hover.id, 'default', '{red.200}');
    expect(res.ok).toBe(true);

    const out = await disk('semantics.json');
    expect((out as any).actions.hover.$value).toBe('{primitives.red.200}');
    expect(find(pm, 'semantics', 'actions.hover').resolvedValuesByMode['default']).toBe('#fecaca');
    await pm.dispose();
  });

  it('leaves bare cross-collection aliases alone when that is the convention', async () => {
    const pm = await loaded(SEMANTICS_BARE);
    const hover = find(pm, 'semantics', 'actions.hover');

    const res = await pm.updateValue(hover.id, 'default', '{red.200}');
    expect(res.ok).toBe(true);

    const out = await disk('semantics.json');
    expect((out as any).actions.hover.$value).toBe('{red.200}');
    await pm.dispose();
  });

  it('does not namespace a same-collection alias', async () => {
    const pm = await loaded(SEMANTICS_NAMESPACED);
    const red200 = find(pm, 'primitives', 'red.200');

    const res = await pm.updateValue(red200.id, 'default', '{red.100}');
    expect(res.ok).toBe(true);

    const out = await disk('primitives.json');
    expect((out as any).red['200'].$value).toBe('{red.100}');
    await pm.dispose();
  });

  it('leaves an already-namespaced alias untouched', async () => {
    const pm = await loaded(SEMANTICS_NAMESPACED);
    const hover = find(pm, 'semantics', 'actions.hover');

    await pm.updateValue(hover.id, 'default', '{primitives.slate.600}');

    const out = await disk('semantics.json');
    expect((out as any).actions.hover.$value).toBe('{primitives.slate.600}');
    await pm.dispose();
  });

  it('qualifies aliases written through a batch edit', async () => {
    const pm = await loaded(SEMANTICS_NAMESPACED);
    const hover = find(pm, 'semantics', 'actions.hover');

    const res = await pm.updateValuesBatch([
      { id: hover.id, mode: 'default', value: '{slate.600}' },
    ]);
    expect(res.ok).toBe(true);

    const out = await disk('semantics.json');
    expect((out as any).actions.hover.$value).toBe('{primitives.slate.600}');
    await pm.dispose();
  });

  it('rewrites namespaced references when the target is renamed', async () => {
    const pm = await loaded(SEMANTICS_NAMESPACED);
    const red100 = find(pm, 'primitives', 'red.100');

    expect(pm.renamePreview(red100.id, ['red', '150']).references).toBe(1);
    const res = await pm.renameToken(red100.id, ['red', '150'], true);
    expect(res.ok).toBe(true);

    const out = await disk('semantics.json');
    expect((out as any).actions.hover.$value).toBe('{primitives.red.150}');
    expect(find(pm, 'semantics', 'actions.hover').resolvedValuesByMode['default']).toBe('#fee2e2');
    await pm.dispose();
  });

  it('rewrites namespaced references when the target is moved', async () => {
    const pm = await loaded(SEMANTICS_NAMESPACED);
    const red100 = find(pm, 'primitives', 'red.100');

    const res = await pm.moveTokensBatch([{ id: red100.id, newPath: ['slate', '100'] }]);
    expect(res.ok).toBe(true);

    const out = await disk('semantics.json');
    expect((out as any).actions.hover.$value).toBe('{primitives.slate.100}');
    await pm.dispose();
  });
});
