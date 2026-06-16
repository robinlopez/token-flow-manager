import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type TokenflowConfig } from '@tokenflow/shared';
import { ProjectManager } from './project.js';
import { loadConfig } from './config-loader.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Open a project the way the Session does, honoring the organization source. */
async function openProject(): Promise<ProjectManager> {
  const loaded = await loadConfig(root);
  const pm = new ProjectManager(root, loaded.config, {
    autoDetect: loaded.source === null,
    organizationSource: loaded.organizationSource,
    manifestIssues: loaded.manifestIssues,
  });
  await pm.load();
  return pm;
}

const SAMPLE = JSON.stringify(
  {
    color: {
      $type: 'color',
      gray: { '50': { $value: '#fafafa' }, '900': { $value: '#1c1917' } },
      surface: { primary: { $value: '{color.gray.50}' } },
    },
  },
  null,
  2,
);

describe('ProjectManager — Phase 1 exit criterion', () => {
  it('loads, edits a color, persists, and reloads without corruption', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const state = pm.getState();
    expect(state.tokenCount).toBe(3);
    expect(state.collections[0]!.name).toBe('Tokens');

    // surface.primary aliases gray.50 -> resolves to #fafafa
    const collection = pm.getCollection('Tokens')!;
    const surface = collection.tokens.find((t) => t.path.join('.') === 'color.surface.primary')!;
    expect(surface.isAlias).toBe(true);
    expect(surface.resolvedValuesByMode.default).toBe('#fafafa');

    // Edit gray.50 -> the alias should follow.
    const gray50 = collection.tokens.find((t) => t.path.join('.') === 'color.gray.50')!;
    const result = await pm.updateValue(gray50.id, 'default', '#ffffff');
    expect(result.ok).toBe(true);
    // The aliasing token's resolved value changed too -> reported as affected.
    expect(result.affectedTokenIds).toContain(surface.id);

    // Persisted to disk + key order preserved.
    const onDisk = await readFile(join(root, 'app.tokens.json'), 'utf8');
    expect(onDisk).toContain('#ffffff');
    expect(onDisk.indexOf('"50"')).toBeLessThan(onDisk.indexOf('"900"'));

    // Re-open a fresh manager: edit persisted, resolves correctly.
    const pm2 = new ProjectManager(root, DEFAULT_CONFIG);
    await pm2.load();
    const reloaded = pm2
      .getCollection('Tokens')!
      .tokens.find((t) => t.path.join('.') === 'color.surface.primary')!;
    expect(reloaded.resolvedValuesByMode.default).toBe('#ffffff');

    await pm.dispose();
    await pm2.dispose();
  });

  it('rejects an invalid color value', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const gray50 = pm
      .getCollection('Tokens')!
      .tokens.find((t) => t.path.join('.') === 'color.gray.50')!;
    const result = await pm.updateValue(gray50.id, 'default', 12345);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('invalid-token');
    await pm.dispose();
  });

  it('creates and deletes a token', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const create = await pm.createToken({
      collection: 'Tokens',
      path: ['color', 'gray', '500'],
      type: 'color',
      valuesByMode: { default: '#78716c' },
    });
    expect(create.ok).toBe(true);
    expect(pm.getState().tokenCount).toBe(4);

    const del = await pm.deleteToken(create.token!.id);
    expect(del.ok).toBe(true);
    expect(pm.getState().tokenCount).toBe(3);

    await pm.dispose();
  });

  it('adds, renames, and deletes a collection', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    // Add → a new empty collection backed by a fresh file, switchable immediately.
    const add = await pm.addCollection('Brand');
    expect(add.ok).toBe(true);
    const names = () => pm.getState().collections.map((c) => c.name);
    expect(names()).toContain('Brand');
    const brand = pm.getState().collections.find((c) => c.name === 'Brand')!;
    expect(brand.tokenCount).toBe(0);
    // The backing file is created from the name (its config glob is the exact path).
    const brandFile = pm.getConfig().collections.find((c) => c.name === 'Brand')!.files;
    const brandRel = Array.isArray(brandFile) ? brandFile[0]! : brandFile;
    expect(existsSync(join(root, brandRel))).toBe(true);

    // Duplicate name is rejected.
    const dup = await pm.addCollection('Brand');
    expect(dup.ok).toBe(false);
    expect(dup.diagnostics[0]!.code).toBe('duplicate-token');

    // Rename → config-level; the new name is live and persists across reload.
    const ren = await pm.renameCollection('Brand', 'Marque');
    expect(ren.ok).toBe(true);
    expect(names()).toContain('Marque');
    expect(names()).not.toContain('Brand');

    const pm2 = new ProjectManager(root, pm.getConfig());
    await pm2.load();
    expect(pm2.getState().collections.map((c) => c.name)).toContain('Marque');
    await pm2.dispose();

    // Delete → removed from config (file left on disk).
    const del = await pm.deleteCollection('Marque');
    expect(del.ok).toBe(true);
    expect(names()).not.toContain('Marque');
    expect(existsSync(join(root, brandRel))).toBe(true);

    // The last remaining collection cannot be deleted.
    const last = await pm.deleteCollection('Tokens');
    expect(last.ok).toBe(false);

    await pm.dispose();
  });

  it('creates a multi-mode variable on a mode-folded collection (ISSUE #1)', async () => {
    // modeLight/modeDark folded into columns: a created token must land as a
    // per-mode node at the physical path, not a broken inline `$value` object.
    const doc = {
      color: {
        modeLight: { surface: { bg: { $value: '#ffffff' } } },
        modeDark: { surface: { bg: { $value: '#000000' } } },
      },
    };
    const file = join(root, 'theme.tokens.json');
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const create = await pm.createToken({
      collection: 'Tokens',
      path: ['color', 'surface', 'accent'],
      type: 'color',
      valuesByMode: { modeLight: '#112233', modeDark: '#445566' },
    });
    expect(create.ok).toBe(true);
    // Logical token shows one value per mode column (not a nested object).
    expect(create.token!.resolvedValuesByMode).toEqual({
      modeLight: '#112233',
      modeDark: '#445566',
    });
    // On disk: a scalar node per mode under the mode segment.
    let disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.surface.accent.$value).toBe('#112233');
    expect(disk.color.modeDark.surface.accent.$value).toBe('#445566');

    // Delete must also be mode-aware: both physical nodes removed.
    const del = await pm.deleteToken(create.token!.id);
    expect(del.ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.surface.accent).toBeUndefined();
    expect(disk.color.modeDark.surface.accent).toBeUndefined();

    await pm.dispose();
  });

  it('reorders, moves a group, and moves a token on a mode-folded collection (ISSUE #1)', async () => {
    // modeLight/modeDark at depth 1 → auto-detected mode dimension; the logical
    // path drops the mode segment (surfaces as columns), but on disk it stays.
    const doc = {
      color: {
        modeLight: {
          surface: { bg: { $value: '#ffffff' }, fg: { $value: '#000000' } },
          brand: { primary: { $value: '#aa0000' } },
        },
        modeDark: {
          surface: { bg: { $value: '#000000' }, fg: { $value: '#ffffff' } },
          brand: { primary: { $value: '#ff0000' } },
        },
      },
    };
    const file = join(root, 'theme.tokens.json');
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const col = pm.getCollection('Tokens')!;
    // Logical paths drop the mode segment; modes are columns.
    const bg = col.tokens.find((t) => t.path.join('.') === 'color.surface.bg')!;
    expect(bg).toBeDefined();
    expect(bg.resolvedValuesByMode).toEqual({ modeLight: '#ffffff', modeDark: '#000000' });

    // --- reorder: swap fg before bg within color.surface (per-mode on disk) ---
    const reordered = await pm.reorderTokens('Tokens', ['color', 'surface'], ['fg', 'bg']);
    expect(reordered.ok).toBe(true);
    let disk = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(disk.color.modeLight.surface)).toEqual(['fg', 'bg']);
    expect(Object.keys(disk.color.modeDark.surface)).toEqual(['fg', 'bg']);

    // --- moveGroup: re-nest color.brand under color.surface (per-mode) ---
    const moved = await pm.moveGroup('Tokens', ['color', 'brand'], ['color', 'surface']);
    expect(moved.ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.brand).toBeUndefined();
    expect(disk.color.modeLight.surface.brand.primary.$value).toBe('#aa0000');
    expect(disk.color.modeDark.surface.brand.primary.$value).toBe('#ff0000');

    // --- moveTokens (rename): move color.surface.fg → color.surface.text ---
    const fg = pm
      .getCollection('Tokens')!
      .tokens.find((t) => t.path.join('.') === 'color.surface.fg')!;
    const renamed = await pm.renameToken(fg.id, ['color', 'surface', 'text']);
    expect(renamed.ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.surface.fg).toBeUndefined();
    expect(disk.color.modeLight.surface.text.$value).toBe('#000000');
    expect(disk.color.modeDark.surface.text.$value).toBe('#ffffff');

    await pm.dispose();
  });

  it('renames, deletes, and duplicates groups/tokens on a mode-folded collection', async () => {
    const doc = {
      color: {
        modeLight: {
          surface: { bg: { $value: '#fff' }, fg: { $value: '#000' } },
          brand: { primary: { $value: '#a00' } },
        },
        modeDark: {
          surface: { bg: { $value: '#000' }, fg: { $value: '#fff' } },
          brand: { primary: { $value: '#f00' } },
        },
      },
    };
    const file = join(root, 'theme.tokens.json');
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    // rename group color.surface → color.bgs (per mode on disk)
    expect((await pm.renameGroup('Tokens', ['color', 'surface'], 'bgs')).ok).toBe(true);
    let disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.surface).toBeUndefined();
    expect(disk.color.modeLight.bgs.bg.$value).toBe('#fff');
    expect(disk.color.modeDark.bgs.fg.$value).toBe('#fff');

    // duplicate the token color.bgs.bg → color.bgs.bg2 (per mode)
    const bg = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.bgs.bg')!;
    expect((await pm.duplicateToken(bg.id)).ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.bgs.bg2.$value).toBe('#fff');
    expect(disk.color.modeDark.bgs.bg2.$value).toBe('#000');

    // duplicate the whole group color.brand → color.brand2 (subtree, per mode)
    expect((await pm.duplicateGroup('Tokens', ['color', 'brand'])).ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.brand2.primary.$value).toBe('#a00');
    expect(disk.color.modeDark.brand2.primary.$value).toBe('#f00');

    // delete group color.brand (per mode)
    expect((await pm.deleteGroup('Tokens', ['color', 'brand'])).ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeLight.brand).toBeUndefined();
    expect(disk.color.modeDark.brand).toBeUndefined();
    expect(disk.color.modeLight.brand2).toBeDefined(); // the duplicate survives

    await pm.dispose();
  });

  it('updateSettings persists tool settings + locks collections without breaking folding', async () => {
    // Mode-folded collection with an in-collection alias.
    const doc = {
      color: {
        modeLight: { base: { $value: '#fff' }, fg: { $value: '{color.base}' } },
        modeDark: { base: { $value: '#000' }, fg: { $value: '{color.base}' } },
      },
    };
    const file = join(root, 'theme.tokens.json');
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG, { autoDetect: true });
    await pm.load();
    expect(pm.getDiagnostics().filter((d) => d.code === 'broken-alias')).toHaveLength(0);

    // Scalar settings persist (autoGenerated stays true — collections not touched).
    const cfg = await pm.updateSettings({ writeDebounceMs: 333, maxAliasDepth: 5 });
    expect(cfg.writeDebounceMs).toBe(333);
    expect(cfg.resolution.maxAliasDepth).toBe(5);
    let onDisk = JSON.parse(await readFile(join(root, 'tokenflow.config.json'), 'utf8'));
    expect(onDisk.autoGenerated).toBe(true);

    // Editing collections snapshots effective modes+dimension and LOCKS the config.
    await pm.updateSettings({ collections: [{ name: 'Tokens' }] });
    onDisk = JSON.parse(await readFile(join(root, 'tokenflow.config.json'), 'utf8'));
    expect(onDisk.autoGenerated).toBe(false);
    expect(onDisk.collections[0].modeDimension).toBe(1); // snapshot kept the dimension
    // Folding (and the alias) survive a reload because the dimension was kept.
    await pm.reload();
    expect(pm.getDiagnostics().filter((d) => d.code === 'broken-alias')).toHaveLength(0);
    const fg = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.fg')!;
    expect(fg.resolvedValuesByMode.modeDark).toBe('#000');

    await pm.dispose();
  });

  it('lets you declare a mode dimension manually (folds groups into modes)', async () => {
    // tablet/desktop/mobile aren't auto-detected as modes → show up as groups.
    const doc = {
      desktop: { screen: { width: { $value: '1440px' } } },
      tablet: { screen: { width: { $value: '1024px' } } },
      mobile: { screen: { width: { $value: '390px' } } },
    };
    await writeFile(join(root, 'responsive.json'), JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG, { autoDetect: true });
    await pm.load();

    const name = pm.getState().collections[0]!.name;
    // Not folded yet: width exists three times (per top-level "group").
    const before = pm.getCollection(name)!.tokens.filter((t) => t.path.at(-1) === 'width');
    expect(before.length).toBe(3);

    // Declare depth 0 as the mode dimension.
    await pm.updateSettings({
      collections: [{ name, modeDimension: 0, modes: ['desktop', 'tablet', 'mobile'] }],
    });
    const folded = pm.getCollection(name)!.tokens.filter((t) => t.path.join('.') === 'screen.width');
    expect(folded.length).toBe(1);
    expect(folded[0]!.resolvedValuesByMode).toEqual({
      desktop: '1440px',
      tablet: '1024px',
      mobile: '390px',
    });
    // Persisted + survives reload (collections locked).
    await pm.reload();
    expect(
      pm.getCollection(name)!.tokens.filter((t) => t.path.join('.') === 'screen.width').length,
    ).toBe(1);

    await pm.dispose();
  });

  it('supports multi-mode collections via inline values', async () => {
    const config: TokenflowConfig = {
      collections: [{ name: 'Tokens', files: '**/*.tokens.json', modes: ['light', 'dark'] }],
      resolution: { crossCollection: true, maxAliasDepth: 10 },
      writeDebounceMs: 200,
      strictTypes: false,
      inferTypes: true,
    };
    await writeFile(
      join(root, 'theme.tokens.json'),
      JSON.stringify(
        { bg: { $type: 'color', $value: { light: '#ffffff', dark: '#000000' } } },
        null,
        2,
      ) + '\n',
    );
    const pm = new ProjectManager(root, config);
    await pm.load();
    const bg = pm.getCollection('Tokens')!.tokens[0]!;
    expect(bg.resolvedValuesByMode).toEqual({ light: '#ffffff', dark: '#000000' });

    const result = await pm.updateValue(bg.id, 'dark', '#111111');
    expect(result.ok).toBe(true);
    const onDisk = await readFile(join(root, 'theme.tokens.json'), 'utf8');
    expect(JSON.parse(onDisk).bg.$value).toEqual({ light: '#ffffff', dark: '#111111' });

    await pm.dispose();
  });
});

describe('ProjectManager — Phase 3.6 undo/redo (byte-exact)', () => {
  it('reverts heterogeneous ops byte-for-byte, then redoes them identically', async () => {
    const path = join(root, 'app.tokens.json');
    const c0 = SAMPLE + '\n';
    await writeFile(path, c0);
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const id = (p: string) =>
      pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === p)!.id;

    // 1) edit a value  2) edit another value  3) reorder a group  4) duplicate
    expect((await pm.updateValue(id('color.gray.50'), 'default', '#ffffff')).ok).toBe(true);
    expect((await pm.updateValue(id('color.gray.900'), 'default', '#000000')).ok).toBe(true);
    expect((await pm.reorderTokens('Tokens', ['color'], ['surface', 'gray'])).ok).toBe(true);
    expect((await pm.duplicateToken(id('color.surface.primary'))).ok).toBe(true);

    const cAfter = await readFile(path, 'utf8');
    expect(cAfter).not.toBe(c0);
    expect(pm.getHistoryState().undo.length).toBe(4);

    // Undo all four → byte-identical to the original.
    for (let i = 0; i < 4; i++) expect((await pm.undo()).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(c0);
    expect(pm.getHistoryState().canUndo).toBe(false);
    expect(pm.getHistoryState().canRedo).toBe(true);

    // Redo all four → byte-identical to the post-ops state.
    for (let i = 0; i < 4; i++) expect((await pm.redo()).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(cAfter);

    await pm.dispose();
  });

  it('undoes and redoes a mode operation (structural: files + config)', async () => {
    const cfgPath = join(root, 'tokenflow.config.json');
    await writeFile(
      cfgPath,
      JSON.stringify(
        {
          collections: [{ name: 'Tokens', files: 'app.tokens.json' }],
          resolution: { crossCollection: true, maxAliasDepth: 10 },
        },
        null,
        2,
      ) + '\n',
    );
    const tokPath = join(root, 'app.tokens.json');
    await writeFile(tokPath, SAMPLE + '\n');

    const { config } = await loadConfig(root);
    const pm = new ProjectManager(root, config);
    await pm.load();

    const cfg0 = await readFile(cfgPath, 'utf8');
    const tok0 = await readFile(tokPath, 'utf8');
    const modeIds = () => pm.getCollection('Tokens')!.modes.map((m) => m.id);
    expect(modeIds()).toEqual(['default']);

    // Add a mode → the collection becomes multi-mode, recorded as ONE undo item.
    expect((await pm.addMode('Tokens', 'dark')).ok).toBe(true);
    expect(modeIds()).toContain('dark');
    expect(pm.getHistoryState().undo.length).toBe(1);
    const cfgAfter = await readFile(cfgPath, 'utf8');
    const tokAfter = await readFile(tokPath, 'utf8');
    expect(tokAfter).not.toBe(tok0); // values were wrapped into inline modes

    // Undo → byte-exact original config + token file; back to a single mode.
    expect((await pm.undo()).ok).toBe(true);
    expect(await readFile(cfgPath, 'utf8')).toBe(cfg0);
    expect(await readFile(tokPath, 'utf8')).toBe(tok0);
    expect(modeIds()).toEqual(['default']);

    // Redo → mode restored, byte-exact post-add state.
    expect((await pm.redo()).ok).toBe(true);
    expect(await readFile(cfgPath, 'utf8')).toBe(cfgAfter);
    expect(await readFile(tokPath, 'utf8')).toBe(tokAfter);
    expect(modeIds()).toContain('dark');

    await pm.dispose();
  });

  it('coalesces rapid edits to the same cell into one history item', async () => {
    const path = join(root, 'app.tokens.json');
    const c0 = SAMPLE + '\n';
    await writeFile(path, c0);
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const gray50 = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.gray.50')!.id;

    await pm.updateValue(gray50, 'default', '#ffffff');
    await pm.updateValue(gray50, 'default', '#eeeeee');
    expect(pm.getHistoryState().undo.length).toBe(1);

    expect((await pm.undo()).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(c0);
    expect(pm.getHistoryState().canUndo).toBe(false);

    await pm.dispose();
  });

  it('refuses to undo when a file diverged on disk, unless forced', async () => {
    const path = join(root, 'app.tokens.json');
    await writeFile(path, SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const gray50 = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.gray.50')!.id;
    await pm.updateValue(gray50, 'default', '#ffffff');

    // Simulate an external edit (and keep the in-memory cache in sync so only the
    // on-disk content has diverged from the recorded "after" snapshot).
    const tampered = (await readFile(path, 'utf8')).replace('#ffffff', '#abcabc');
    await writeFile(path, tampered);

    const blocked = await pm.undo();
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('diverged');
    expect(blocked.diverged).toContain('app.tokens.json');

    const forced = await pm.undo(true);
    expect(forced.ok).toBe(true);

    await pm.dispose();
  });

  it('a new mutation clears the redo stack', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const id = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.gray.50')!.id;

    await pm.updateValue(id, 'default', '#ffffff');
    await pm.undo();
    expect(pm.getHistoryState().canRedo).toBe(true);
    await pm.updateValue(id, 'default', '#dddddd');
    expect(pm.getHistoryState().canRedo).toBe(false);

    await pm.dispose();
  });
});

describe('ProjectManager — reorder of numeric keys', () => {
  it('reports a clear failure instead of silently snapping back', async () => {
    const doc = {
      color: {
        $type: 'color',
        scale: { '50': { $value: '#fafafa' }, '500': { $value: '#888888' }, '900': { $value: '#111111' } },
      },
    };
    await writeFile(join(root, 'app.tokens.json'), JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    // Try to move "500" to the front — impossible: JSON serialises integer keys ascending.
    const res = await pm.reorderTokens('Tokens', ['color', 'scale'], ['500', '50', '900']);
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]!.message).toMatch(/numeric keys/i);
    // No spurious history item from the no-op.
    expect(pm.getHistoryState().canUndo).toBe(false);

    await pm.dispose();
  });
});

describe('ProjectManager — batch value edits (Phase 3.5.3)', () => {
  it('applies many edits in one transaction = one undo item', async () => {
    const path = join(root, 'app.tokens.json');
    const c0 = SAMPLE + '\n';
    await writeFile(path, c0);
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const id = (p: string) => pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === p)!.id;

    const res = await pm.updateValuesBatch([
      { id: id('color.gray.50'), mode: 'default', value: '#ffffff' },
      { id: id('color.gray.900'), mode: 'default', value: '#000000' },
    ]);
    expect(res.ok).toBe(true);
    expect(pm.getHistoryState().undo.length).toBe(1); // single item for both edits

    // One undo reverts BOTH edits, byte-exact.
    expect((await pm.undo()).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(c0);

    await pm.dispose();
  });

  it('rejects the whole batch if any value is invalid (atomic)', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const id = (p: string) => pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === p)!.id;

    const res = await pm.updateValuesBatch([
      { id: id('color.gray.50'), mode: 'default', value: '#ffffff' },
      { id: id('color.gray.900'), mode: 'default', value: 12345 }, // invalid color
    ]);
    expect(res.ok).toBe(false);
    // Nothing written, no history item.
    expect(pm.getHistoryState().canUndo).toBe(false);

    await pm.dispose();
  });
});

describe('ProjectManager — batch move (multi-selection drag, Phase 3.5.4)', () => {
  it('moves many tokens in one transaction = one undo item', async () => {
    const path = join(root, 'app.tokens.json');
    const c0 = SAMPLE + '\n';
    await writeFile(path, c0);
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const id = (p: string) =>
      pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === p)!.id;

    // Move both gray.50 and gray.900 under color.surface in one batch.
    const res = await pm.moveTokensBatch([
      { id: id('color.gray.50'), newPath: ['color', 'surface', '50'] },
      { id: id('color.gray.900'), newPath: ['color', 'surface', '900'] },
    ]);
    expect(res.ok).toBe(true);
    expect(pm.getHistoryState().undo.length).toBe(1); // single item for both moves

    const after = pm.getCollection('Tokens')!;
    expect(after.tokens.some((t) => t.path.join('.') === 'color.surface.50')).toBe(true);
    expect(after.tokens.some((t) => t.path.join('.') === 'color.surface.900')).toBe(true);
    expect(after.tokens.some((t) => t.path.join('.') === 'color.gray.50')).toBe(false);

    // One undo reverts BOTH moves, byte-exact.
    expect((await pm.undo()).ok).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(c0);

    await pm.dispose();
  });

  it('rejects the whole batch on a collision (atomic, no history item)', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const id = (p: string) =>
      pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === p)!.id;

    // color.surface already has a 'primary' leaf → moving gray.50 onto it collides.
    const res = await pm.moveTokensBatch([
      { id: id('color.gray.50'), newPath: ['color', 'surface', 'primary'] },
    ]);
    expect(res.ok).toBe(false);
    expect(pm.getHistoryState().canUndo).toBe(false);

    await pm.dispose();
  });
});

describe('ProjectManager — copy a variable into another group (paste)', () => {
  it('copies a token under a target parent with a free name', async () => {
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const gray50 = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.gray.50')!;

    // Paste gray.50 under color.surface (which already has 'primary').
    const res = await pm.copyTokenTo(gray50.id, ['color', 'surface']);
    expect(res.ok).toBe(true);
    expect(res.token!.path.join('.')).toBe('color.surface.50');
    // Original still there; the copy carries the same value.
    const surface50 = pm.getCollection('Tokens')!.tokens.find((t) => t.path.join('.') === 'color.surface.50')!;
    expect(surface50.rawValuesByMode.default).toBe('#fafafa');
    expect(pm.getCollection('Tokens')!.tokens.some((t) => t.path.join('.') === 'color.gray.50')).toBe(true);

    // One history item; undo removes the pasted token.
    expect(pm.getHistoryState().undo.length).toBe(1);
    expect((await pm.undo()).ok).toBe(true);
    expect(pm.getCollection('Tokens')!.tokens.some((t) => t.path.join('.') === 'color.surface.50')).toBe(false);

    await pm.dispose();
  });
});

describe('ProjectManager — file-based modes (multi-theme) structural ops', () => {
  const fileModesConfig = (): TokenflowConfig => ({
    collections: [
      {
        name: 'primitives',
        files: ['themeOne.json', 'themeTwo.json'],
        modes: ['themeOne', 'themeTwo'],
        fileModes: { 'themeOne.json': 'themeOne', 'themeTwo.json': 'themeTwo' },
      },
    ],
    resolution: { crossCollection: true, maxAliasDepth: 10 },
    writeDebounceMs: 200,
    strictTypes: false,
    inferTypes: true,
  });

  it('copyTokenTo copies the token into EVERY theme file (not just the first)', async () => {
    const mk = (p: string) => JSON.stringify({ primary: { a: { $value: p + '-a' } }, secondary: {} }, null, 2);
    await writeFile(join(root, 'themeOne.json'), mk('one'));
    await writeFile(join(root, 'themeTwo.json'), mk('two'));
    const pm = new ProjectManager(root, fileModesConfig());
    await pm.load();

    const src = pm.getCollection('primitives')!.tokens.find((t) => t.path.join('.') === 'primary.a')!;
    const res = await pm.copyTokenTo(src.id, ['secondary']);
    expect(res.ok).toBe(true);
    const pasted = pm.getCollection('primitives')!.tokens.find((t) => t.path.join('.') === res.token!.path.join('.'))!;
    // Both themes copied, each from its own file's source value.
    expect(pasted.rawValuesByMode).toEqual({ themeOne: 'one-a', themeTwo: 'two-a' });

    const t1 = JSON.parse(await readFile(join(root, 'themeOne.json'), 'utf8'));
    const t2 = JSON.parse(await readFile(join(root, 'themeTwo.json'), 'utf8'));
    expect(t1.secondary.a.$value).toBe('one-a');
    expect(t2.secondary.a.$value).toBe('two-a');

    await pm.dispose();
  });
});

describe('ProjectManager — mode management (add / rename)', () => {
  const inlineConfig = (modes: string[]): TokenflowConfig => ({
    collections: [{ name: 'c', files: 'inline.json', modes }],
    resolution: { crossCollection: true, maxAliasDepth: 10 },
    writeDebounceMs: 200,
    strictTypes: false,
    inferTypes: true,
  });

  it('dimension: adds a mode by cloning a segment subtree, then renames it', async () => {
    const doc = {
      color: {
        modeLight: { bg: { $value: '#fff' }, fg: { $value: '#000' } },
        modeDark: { bg: { $value: '#000' }, fg: { $value: '#fff' } },
      },
    };
    const file = join(root, 'theme.tokens.json');
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG, { autoDetect: true });
    await pm.load();
    const name = pm.getState().collections[0]!.name;

    // Add 'modeHC' as a copy of modeLight (a whole new path subtree per parent).
    expect((await pm.addMode(name, 'modeHC', 'modeLight')).ok).toBe(true);
    let disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeHC.bg.$value).toBe('#fff');
    expect(disk.color.modeHC.fg.$value).toBe('#000');
    let bg = pm.getCollection(name)!.tokens.find((t) => t.path.join('.') === 'color.bg')!;
    expect(bg.resolvedValuesByMode.modeHC).toBe('#fff'); // surfaces as a column

    // Rename the segment on disk, position preserved.
    expect((await pm.renameMode(name, 'modeHC', 'modeContrast')).ok).toBe(true);
    disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeHC).toBeUndefined();
    expect(disk.color.modeContrast.bg.$value).toBe('#fff');
    bg = pm.getCollection(name)!.tokens.find((t) => t.path.join('.') === 'color.bg')!;
    expect(bg.resolvedValuesByMode.modeContrast).toBe('#fff');

    await pm.dispose();
  });

  it('inline: adds and renames a $value mode key in place', async () => {
    const doc = { color: { bg: { $type: 'color', $value: { light: '#fff', dark: '#000' } } } };
    await writeFile(join(root, 'inline.json'), JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, inlineConfig(['light', 'dark']));
    await pm.load();

    expect((await pm.addMode('c', 'hc', 'light')).ok).toBe(true);
    let disk = JSON.parse(await readFile(join(root, 'inline.json'), 'utf8'));
    expect(disk.color.bg.$value).toEqual({ light: '#fff', dark: '#000', hc: '#fff' });

    expect((await pm.renameMode('c', 'hc', 'contrast')).ok).toBe(true);
    disk = JSON.parse(await readFile(join(root, 'inline.json'), 'utf8'));
    expect(disk.color.bg.$value).toEqual({ light: '#fff', dark: '#000', contrast: '#fff' });
    expect(Object.keys(disk.color.bg.$value)).toEqual(['light', 'dark', 'contrast']); // order kept

    await pm.dispose();
  });

  it('file: adds a mode as a copied file, routes edits to it, renames relabel-only', async () => {
    const mk = (v: string) => JSON.stringify({ primary: { a: { $value: v } } }, null, 2) + '\n';
    await writeFile(join(root, 'themeOne.json'), mk('#111'));
    await writeFile(join(root, 'themeTwo.json'), mk('#222'));
    const config: TokenflowConfig = {
      collections: [
        {
          name: 'primitives',
          files: ['themeOne.json', 'themeTwo.json'],
          modes: ['themeOne', 'themeTwo'],
          fileModes: { 'themeOne.json': 'themeOne', 'themeTwo.json': 'themeTwo' },
        },
      ],
      resolution: { crossCollection: true, maxAliasDepth: 10 },
      writeDebounceMs: 200,
      strictTypes: false,
      inferTypes: true,
    };
    const pm = new ProjectManager(root, config);
    await pm.load();

    // Add 'themeThree' copied from themeTwo → new file themeThree.json.
    expect((await pm.addMode('primitives', 'themeThree', 'themeTwo')).ok).toBe(true);
    expect(existsSync(join(root, 'themeThree.json'))).toBe(true);
    expect(JSON.parse(await readFile(join(root, 'themeThree.json'), 'utf8')).primary.a.$value).toBe('#222');
    let a = pm.getCollection('primitives')!.tokens.find((t) => t.path.join('.') === 'primary.a')!;
    expect(a.resolvedValuesByMode.themeThree).toBe('#222');

    // Editing the new mode writes to ITS file, not the first (file-routing fix).
    expect((await pm.updateValue(a.id, 'themeThree', '#333')).ok).toBe(true);
    expect(JSON.parse(await readFile(join(root, 'themeThree.json'), 'utf8')).primary.a.$value).toBe('#333');
    expect(JSON.parse(await readFile(join(root, 'themeOne.json'), 'utf8')).primary.a.$value).toBe('#111');

    // Rename relabels in config; the file is kept (downstream build refs it).
    expect((await pm.renameMode('primitives', 'themeThree', 'brandX')).ok).toBe(true);
    expect(existsSync(join(root, 'themeThree.json'))).toBe(true);
    a = pm.getCollection('primitives')!.tokens.find((t) => t.path.join('.') === 'primary.a')!;
    expect(a.resolvedValuesByMode.brandX).toBe('#333');
    expect(a.resolvedValuesByMode.themeThree).toBeUndefined();

    await pm.dispose();
  });

  it('none → inline: adding the first extra mode wraps scalar values', async () => {
    const doc = { space: { sm: { $type: 'dimension', $value: '4px' } } };
    await writeFile(join(root, 'inline.json'), JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, inlineConfig([]));
    await pm.load();

    expect((await pm.addMode('c', 'compact')).ok).toBe(true); // no src → seed from default
    const disk = JSON.parse(await readFile(join(root, 'inline.json'), 'utf8'));
    expect(disk.space.sm.$value).toEqual({ default: '4px', compact: '4px' });
    const sm = pm.getCollection('c')!.tokens.find((t) => t.path.join('.') === 'space.sm')!;
    expect(sm.resolvedValuesByMode).toEqual({ default: '4px', compact: '4px' });

    await pm.dispose();
  });

  it('rejects a duplicate mode name', async () => {
    const doc = { color: { bg: { $type: 'color', $value: { light: '#fff', dark: '#000' } } } };
    await writeFile(join(root, 'inline.json'), JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, inlineConfig(['light', 'dark']));
    await pm.load();
    expect((await pm.addMode('c', 'dark', 'light')).ok).toBe(false);
    expect((await pm.renameMode('c', 'light', 'dark')).ok).toBe(false);
    await pm.dispose();
  });

  it('inline: deletes a mode key, and refuses to delete the last one', async () => {
    const doc = { color: { bg: { $type: 'color', $value: { light: '#fff', dark: '#000' } } } };
    await writeFile(join(root, 'inline.json'), JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, inlineConfig(['light', 'dark']));
    await pm.load();

    expect((await pm.deleteMode('c', 'dark')).ok).toBe(true);
    const disk = JSON.parse(await readFile(join(root, 'inline.json'), 'utf8'));
    expect(disk.color.bg.$value).toEqual({ light: '#fff' });
    // 'light' is now the only mode → cannot be removed.
    expect((await pm.deleteMode('c', 'light')).ok).toBe(false);

    await pm.dispose();
  });

  it('dimension: deletes a mode subtree from every file', async () => {
    const doc = {
      color: {
        modeLight: { bg: { $value: '#fff' } },
        modeDark: { bg: { $value: '#000' } },
        modeHc: { bg: { $value: '#111' } },
      },
    };
    const file = join(root, 'theme.tokens.json');
    await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG, { autoDetect: true });
    await pm.load();
    const name = pm.getState().collections[0]!.name;

    expect((await pm.deleteMode(name, 'modeHc')).ok).toBe(true);
    const disk = JSON.parse(await readFile(file, 'utf8'));
    expect(disk.color.modeHc).toBeUndefined();
    expect(disk.color.modeLight.bg.$value).toBe('#fff');
    const bg = pm.getCollection(name)!.tokens.find((t) => t.path.join('.') === 'color.bg')!;
    expect(Object.keys(bg.resolvedValuesByMode).sort()).toEqual(['modeDark', 'modeLight']);

    await pm.dispose();
  });

  it('file: deletes a mode (unregisters it) and duplicates a mode into a copy', async () => {
    const mk = (v: string) => JSON.stringify({ primary: { a: { $value: v } } }, null, 2) + '\n';
    await writeFile(join(root, 'themeOne.json'), mk('#111'));
    await writeFile(join(root, 'themeTwo.json'), mk('#222'));
    const config: TokenflowConfig = {
      collections: [
        {
          name: 'primitives',
          files: ['themeOne.json', 'themeTwo.json'],
          modes: ['themeOne', 'themeTwo'],
          fileModes: { 'themeOne.json': 'themeOne', 'themeTwo.json': 'themeTwo' },
        },
      ],
      resolution: { crossCollection: true, maxAliasDepth: 10 },
      writeDebounceMs: 200,
      strictTypes: false,
      inferTypes: true,
    };
    const pm = new ProjectManager(root, config);
    await pm.load();

    // Duplicate themeOne → themeOne2 (new copied file).
    expect((await pm.duplicateMode('primitives', 'themeOne')).ok).toBe(true);
    expect(existsSync(join(root, 'themeOne2.json'))).toBe(true);
    let a = pm.getCollection('primitives')!.tokens.find((t) => t.path.join('.') === 'primary.a')!;
    expect(a.resolvedValuesByMode.themeOne2).toBe('#111');

    // Delete themeTwo → unregistered (mode gone), file left on disk.
    expect((await pm.deleteMode('primitives', 'themeTwo')).ok).toBe(true);
    expect(existsSync(join(root, 'themeTwo.json'))).toBe(true);
    a = pm.getCollection('primitives')!.tokens.find((t) => t.path.join('.') === 'primary.a')!;
    expect(a.resolvedValuesByMode.themeTwo).toBeUndefined();
    expect(Object.keys(a.resolvedValuesByMode).sort()).toEqual(['themeOne', 'themeOne2']);

    await pm.dispose();
  });
});

describe('ProjectManager — manifest.json organization', () => {
  const SEMANTICS = JSON.stringify(
    {
      color: {
        modeLight: { bg: { $type: 'color', $value: '#ffffff' } },
        modeDark: { bg: { $type: 'color', $value: '#000000' } },
      },
    },
    null,
    2,
  ) + '\n';
  const METRICS = JSON.stringify({ space: { sm: { $type: 'dimension', $value: '4px' } } }, null, 2) + '\n';
  const MANIFEST = JSON.stringify(
    {
      name: 'Design Tokens',
      collections: {
        Semantics: { modes: { Light: ['semantics.json'], Dark: ['semantics.json'] } },
        Metrics: { modes: { 'Mode 1': ['metrics.json'] } },
      },
    },
    null,
    2,
  ) + '\n';

  async function writeManifestProject(): Promise<void> {
    await writeFile(join(root, 'semantics.json'), SEMANTICS);
    await writeFile(join(root, 'metrics.json'), METRICS);
    await writeFile(join(root, 'manifest.json'), MANIFEST);
  }

  it('derives collections + modes from manifest.json (shared file → dimension, with labels)', async () => {
    await writeManifestProject();
    const pm = await openProject();

    expect(pm.getState().setup?.organizationSource).toBe('manifest');

    // Shared-file modes folded into columns, manifest names ride as labels.
    const sem = pm.getCollection('Semantics')!;
    expect(sem.modes.map((m) => m.id)).toEqual(['modeLight', 'modeDark']);
    expect(sem.modes.map((m) => m.label)).toEqual(['Light', 'Dark']);
    const bg = sem.tokens.find((t) => t.path.join('.') === 'color.bg')!;
    expect(bg.resolvedValuesByMode.modeLight).toBe('#ffffff');
    expect(bg.resolvedValuesByMode.modeDark).toBe('#000000');

    // Single-mode collection.
    expect(pm.getCollection('Metrics')!.modes).toHaveLength(1);

    await pm.dispose();
  });

  it('writes the manifest on a structural op; undo restores it byte-exact; config stays prefs-only', async () => {
    await writeManifestProject();
    const cfgPath = join(root, 'tokenflow.config.json');
    await writeFile(
      cfgPath,
      JSON.stringify({ strictTypes: false, inferTypes: true }, null, 2) + '\n',
    );
    const pm = await openProject();

    const manifest0 = await readFile(join(root, 'manifest.json'), 'utf8');

    // Add a mode to a single-mode collection (Metrics) → manifest gains the mode.
    expect((await pm.addMode('Metrics', 'dark')).ok).toBe(true);
    const manifestAfter = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifestAfter.collections.Metrics.modes).length).toBe(2);

    // tokenflow.config.json carries preferences only — no collections.
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    expect(cfg.collections).toBeUndefined();
    expect(cfg.strictTypes).toBe(false);

    // Undo → manifest.json restored byte-exact.
    expect((await pm.undo()).ok).toBe(true);
    expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe(manifest0);

    await pm.dispose();
  });

  it('survives deleting manifest.json (settings-only config) without crashing', async () => {
    await writeManifestProject();
    // The slim, settings-only config a manifest project writes (no collections).
    await writeFile(
      join(root, 'tokenflow.config.json'),
      JSON.stringify(
        { resolution: { crossCollection: true, maxAliasDepth: 10 }, strictTypes: false, inferTypes: true },
        null,
        2,
      ) + '\n',
    );
    const pm = await openProject();
    expect(pm.getState().setup?.organizationSource).toBe('manifest');

    // User deletes the manifest on disk, then the tool refreshes.
    await rm(join(root, 'manifest.json'));
    await expect(pm.reload()).resolves.toBeUndefined(); // no ZodError
    expect(pm.getState().setup?.organizationSource).toBe('auto');
    expect(pm.getState().collections.length).toBeGreaterThan(0); // still usable

    // Re-opening a fresh manager on the settings-only config must not throw either.
    const reopened = await openProject();
    expect(reopened.getState().open).toBe(true);

    await pm.dispose();
    await reopened.dispose();
  });

  it('generates manifest.json from an auto-detected project and slims the config', async () => {
    // No manifest, no config → auto-detected organization.
    await writeFile(join(root, 'semantics.json'), SEMANTICS);
    const pm = await openProject();
    expect(pm.getState().setup?.organizationSource).toBe('auto');
    expect(pm.getState().setup?.issues.some((i) => i.code === 'no-manifest')).toBe(true);

    expect((await pm.generateOrgManifest()).ok).toBe(true);
    expect(existsSync(join(root, 'manifest.json'))).toBe(true);
    expect(pm.getState().setup?.organizationSource).toBe('manifest');
    expect(pm.getState().setup?.issues.some((i) => i.code === 'no-manifest')).toBe(false);

    await pm.dispose();
  });
});
