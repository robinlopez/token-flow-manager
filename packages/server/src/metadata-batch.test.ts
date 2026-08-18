import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@tokenflow/shared';
import { ProjectManager } from './project.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-meta-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const figmaBlock = (modeId: string, scopes: string[]) => ({
  variableId: `VariableID:1:${modeId}`,
  collectionId: 'VariableCollectionId:1:0',
  modeId,
  resolvedType: 'FLOAT',
  scopes,
});

const DOC = {
  radius: {
    $type: 'dimension',
    sm: { $value: '4px', $extensions: { 'com.figma': figmaBlock('1:1', ['CORNER_RADIUS']) } },
    md: { $value: '8px', $extensions: { 'com.figma': figmaBlock('1:2', ['CORNER_RADIUS']) } },
    lg: { $value: '12px' },
  },
  brand: { $type: 'color', primary: { $value: '#ff0000' } },
};

async function open(doc: unknown = DOC): Promise<ProjectManager> {
  await writeFile(join(root, 'app.tokens.json'), JSON.stringify(doc, null, 2) + '\n');
  const pm = new ProjectManager(root, DEFAULT_CONFIG);
  await pm.load();
  return pm;
}

const idOf = (pm: ProjectManager, path: string): string =>
  pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === path)!.id;

const disk = async (): Promise<any> =>
  JSON.parse(await readFile(join(root, 'app.tokens.json'), 'utf8'));

describe('updateMetadataBatch — descriptions', () => {
  it('sets one description on many variables as a single undo item', async () => {
    const pm = await open();
    const ids = ['radius.sm', 'radius.md', 'radius.lg'].map((p) => idOf(pm, p));

    const res = await pm.updateMetadataBatch(ids.map((id) => ({ id, description: 'Corner radius' })));
    expect(res.ok).toBe(true);
    expect(res.affectedTokenIds.sort()).toEqual([...ids].sort());

    const out = await disk();
    expect(out.radius.sm.$description).toBe('Corner radius');
    expect(out.radius.md.$description).toBe('Corner radius');
    expect(out.radius.lg.$description).toBe('Corner radius');

    const history = pm.getHistoryState();
    expect(history.undoLabel).toBe('Describe 3 variables');
    await pm.undo();
    const reverted = await disk();
    expect(reverted.radius.sm.$description).toBeUndefined();
    expect(reverted.radius.lg.$description).toBeUndefined();
    await pm.dispose();
  });

  it('clears a description with an empty string and leaves untouched tokens alone', async () => {
    const pm = await open();
    await pm.updateMetadataBatch([{ id: idOf(pm, 'radius.sm'), description: 'x' }]);
    await pm.updateMetadataBatch([{ id: idOf(pm, 'radius.sm'), description: '  ' }]);
    const out = await disk();
    expect(out.radius.sm.$description).toBeUndefined();
    expect(out.radius.md.$description).toBeUndefined();
    await pm.dispose();
  });
});

describe('updateMetadataBatch — com.figma extensions', () => {
  it('merges scopes without touching binding identities', async () => {
    const pm = await open();
    const ids = ['radius.sm', 'radius.md'].map((p) => idOf(pm, p));

    const res = await pm.updateMetadataBatch(
      ids.map((id) => ({ id, extensions: { 'com.figma': { scopes: ['CORNER_RADIUS', 'GAP'] } } })),
    );
    expect(res.ok).toBe(true);

    const out = await disk();
    expect(out.radius.sm.$extensions['com.figma']).toEqual({
      ...figmaBlock('1:1', ['CORNER_RADIUS', 'GAP']),
    });
    expect(out.radius.md.$extensions['com.figma'].modeId).toBe('1:2');
    expect(pm.getHistoryState().undoLabel).toBe('Edit extensions on 2 variables');
    await pm.dispose();
  });

  it('creates the com.figma block on a variable that has none', async () => {
    const pm = await open();
    const res = await pm.updateMetadataBatch([
      {
        id: idOf(pm, 'radius.lg'),
        extensions: { 'com.figma': { resolvedType: 'FLOAT', scopes: ['WIDTH_HEIGHT'] } },
      },
    ]);
    expect(res.ok).toBe(true);
    const out = await disk();
    expect(out.radius.lg.$extensions).toEqual({
      'com.figma': { resolvedType: 'FLOAT', scopes: ['WIDTH_HEIGHT'] },
    });
    await pm.dispose();
  });

  it('applies a description and an extension in one transaction', async () => {
    const pm = await open();
    const res = await pm.updateMetadataBatch([
      {
        id: idOf(pm, 'radius.sm'),
        description: 'Small radius',
        extensions: { 'com.figma': { hiddenFromPublishing: true } },
      },
    ]);
    expect(res.ok).toBe(true);
    const out = await disk();
    expect(out.radius.sm.$description).toBe('Small radius');
    expect(out.radius.sm.$extensions['com.figma'].hiddenFromPublishing).toBe(true);
    expect(pm.getHistoryState().undoLabel).toBe('Edit metadata on 1 variable');
    await pm.dispose();
  });

  it('normalizes the scopes it writes (canonical order, ALL_SCOPES exclusivity)', async () => {
    const pm = await open();
    await pm.updateMetadataBatch([
      {
        id: idOf(pm, 'radius.sm'),
        extensions: { 'com.figma': { scopes: ['GAP', 'CORNER_RADIUS', 'GAP'] } },
      },
    ]);
    let out = await disk();
    expect(out.radius.sm.$extensions['com.figma'].scopes).toEqual(['CORNER_RADIUS', 'GAP']);

    await pm.updateMetadataBatch([
      {
        id: idOf(pm, 'radius.sm'),
        extensions: { 'com.figma': { scopes: ['GAP', 'ALL_SCOPES'] } },
      },
    ]);
    out = await disk();
    expect(out.radius.sm.$extensions['com.figma'].scopes).toEqual(['ALL_SCOPES']);
    await pm.dispose();
  });

  it('removes a field with a null value and the block with a null patch', async () => {
    const pm = await open();
    const id = idOf(pm, 'radius.sm');
    await pm.updateMetadataBatch([{ id, extensions: { 'com.figma': { scopes: null } } }]);
    let out = await disk();
    expect(out.radius.sm.$extensions['com.figma'].scopes).toBeUndefined();
    expect(out.radius.sm.$extensions['com.figma'].modeId).toBe('1:1');

    await pm.updateMetadataBatch([{ id, extensions: { 'com.figma': null } }]);
    out = await disk();
    expect(out.radius.sm.$extensions).toBeUndefined();
    await pm.dispose();
  });
});

describe('updateMetadataBatch — validation', () => {
  it('rejects editing a Figma binding identity', async () => {
    const pm = await open();
    const before = await disk();
    const res = await pm.updateMetadataBatch([
      { id: idOf(pm, 'radius.sm'), extensions: { 'com.figma': { variableId: 'VariableID:9:9' } } },
    ]);
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]!.message).toContain('binding identity');
    expect(await disk()).toEqual(before);
    await pm.dispose();
  });

  it('rejects a scope that does not apply to the variable type', async () => {
    const pm = await open();
    const res = await pm.updateMetadataBatch([
      { id: idOf(pm, 'brand.primary'), extensions: { 'com.figma': { scopes: ['CORNER_RADIUS'] } } },
    ]);
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]!.message).toContain('does not apply to a COLOR');
    await pm.dispose();
  });

  it('rejects a resolvedType that contradicts the token type', async () => {
    const pm = await open();
    const res = await pm.updateMetadataBatch([
      { id: idOf(pm, 'brand.primary'), extensions: { 'com.figma': { resolvedType: 'FLOAT' } } },
    ]);
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]!.message).toContain('must be "COLOR"');
    await pm.dispose();
  });

  it('rejects an unknown com.figma field and writes nothing', async () => {
    const pm = await open();
    const before = await disk();
    const res = await pm.updateMetadataBatch([
      { id: idOf(pm, 'radius.sm'), description: 'ok' },
      { id: idOf(pm, 'radius.md'), extensions: { 'com.figma': { nope: 1 } } },
    ]);
    expect(res.ok).toBe(false);
    expect(await disk()).toEqual(before);
    await pm.dispose();
  });
});

describe('updateMetadataBatch — mode-folded collection', () => {
  const FOLDED = {
    color: {
      modeLight: {
        surface: {
          bg: { $value: '#ffffff', $extensions: { 'com.figma': figmaBlock('2:1', ['ALL_FILLS']) } },
        },
      },
      modeDark: {
        surface: {
          bg: { $value: '#000000', $extensions: { 'com.figma': figmaBlock('2:2', ['ALL_FILLS']) } },
        },
      },
    },
  };

  it('writes token-level metadata to every mode node, keeping each modeId', async () => {
    const pm = await open(FOLDED);
    const id = idOf(pm, 'color.surface.bg');
    const res = await pm.updateMetadataBatch([
      { id, description: 'Page background', extensions: { 'com.figma': { scopes: ['FRAME_FILL'] } } },
    ]);
    expect(res.ok).toBe(true);

    const out = await disk();
    for (const [mode, modeId] of [
      ['modeLight', '2:1'],
      ['modeDark', '2:2'],
    ]) {
      const node = out.color[mode!].surface.bg;
      expect(node.$description).toBe('Page background');
      expect(node.$extensions['com.figma'].scopes).toEqual(['FRAME_FILL']);
      expect(node.$extensions['com.figma'].modeId).toBe(modeId);
    }
    await pm.dispose();
  });
});
