import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config-loader.js';
import { ProjectManager } from './project.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-p25-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// PrimeNG-style: generic root $type, untyped leaves, mixed value kinds.
const TRANSITIONS =
  JSON.stringify(
    {
      $description: 'Transition',
      $type: 'design-token',
      transition: { fast: { $value: '80ms' }, easing: { $value: 'ease-in' } },
    },
    null,
    2,
  ) + '\n';

const METRICS =
  JSON.stringify(
    { $type: 'design-token', units: { sm: { $value: '8px' } } },
    null,
    2,
  ) + '\n';

describe('zero-config auto-detection', () => {
  it('maps each token JSON file to its own collection', async () => {
    await writeFile(join(root, 'transitions.json'), TRANSITIONS);
    await mkdir(join(root, 'primitives'), { recursive: true });
    await writeFile(join(root, 'primitives', 'themeOne.json'), METRICS);
    await writeFile(join(root, 'package.json'), '{"name":"x"}'); // ignored

    const { config, source } = await loadConfig(root);
    expect(source).toBeNull();
    const names = config.collections.map((c) => c.name).sort();
    expect(names).toEqual(['primitives/themeOne', 'transitions']);
  });

  it('ignores non-token JSON files', async () => {
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{}}');
    await writeFile(join(root, 'tokens.json'), TRANSITIONS);
    const { config } = await loadConfig(root);
    expect(config.collections.map((c) => c.name)).toEqual(['tokens']);
  });
});

describe('manifest (token-config.json)', () => {
  it('derives collections + file-based theme modes from the manifest', async () => {
    await mkdir(join(root, 'primitives'), { recursive: true });
    await writeFile(
      join(root, 'primitives', 'themeOne.json'),
      JSON.stringify({ primary: { '500': { $value: '#a00' } } }) + '\n',
    );
    await writeFile(
      join(root, 'primitives', 'themeTwo.json'),
      JSON.stringify({ primary: { '500': { $value: '#0a0' } } }) + '\n',
    );
    await writeFile(
      join(root, 'metrics.json'),
      JSON.stringify({ units: { sm: { $value: '8px' } } }) + '\n',
    );
    await writeFile(
      join(root, 'token-config.json'),
      JSON.stringify({
        themes: [
          { name: 'themeOne', primitiveFile: 'themeOne.json' },
          { name: 'themeTwo', primitiveFile: 'themeTwo.json' },
        ],
        tokens: {
          primitives: { enabled: true, sourcePath: 'primitives/' },
          metrics: { enabled: true, sourceFile: 'metrics.json' },
        },
      }) + '\n',
    );

    const { config } = await loadConfig(root);
    const prim = config.collections.find((c) => c.name === 'primitives')!;
    expect(prim.modes).toEqual(['themeOne', 'themeTwo']);
    expect(config.collections.map((c) => c.name).sort()).toEqual(['metrics', 'primitives']);

    const pm = new ProjectManager(root, config);
    await pm.load();
    const tokens = pm.getCollection('primitives')!.tokens;
    // One logical token, two theme modes.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.resolvedValuesByMode).toEqual({ themeOne: '#a00', themeTwo: '#0a0' });
    await pm.dispose();
  });
});

describe('mode dimension auto-detection', () => {
  const SEMANTICS =
    JSON.stringify(
      {
        $type: 'design-token',
        token: {
          modeLight: { surface: { $value: '#ffffff' }, text: { $value: '#000000' } },
          modeDark: { surface: { $value: '#000000' }, text: { $value: '#ffffff' } },
        },
      },
      null,
      2,
    ) + '\n';

  it('detects modeLight/modeDark as collection modes and folds them into columns', async () => {
    await writeFile(join(root, 'semantics.json'), SEMANTICS);
    const { config } = await loadConfig(root);
    const col = config.collections.find((c) => c.name === 'semantics')!;
    expect(col.modes).toEqual(['modeDark', 'modeLight']);
    expect(col.modeDimension).toBe(1);

    const pm = new ProjectManager(root, config);
    await pm.load();
    const tokens = pm.getCollection('semantics')!.tokens;
    // Two logical tokens (surface, text), each with both modes — not four rows.
    expect(tokens).toHaveLength(2);
    const surface = tokens.find((t) => t.path.join('.') === 'token.surface')!;
    expect(surface.resolvedValuesByMode).toEqual({ modeLight: '#ffffff', modeDark: '#000000' });
    expect(pm.getCollection('semantics')!.modes.map((m) => m.id).sort()).toEqual([
      'modeDark',
      'modeLight',
    ]);
    await pm.dispose();
  });

  it('edits a mode-folded token into the correct physical (per-mode) node', async () => {
    await writeFile(join(root, 'semantics.json'), SEMANTICS);
    const { config } = await loadConfig(root);
    const pm = new ProjectManager(root, config);
    await pm.load();
    const surface = pm
      .getCollection('semantics')!
      .tokens.find((t) => t.path.join('.') === 'token.surface')!;

    const res = await pm.updateValue(surface.id, 'modeDark', '#123123');
    expect(res.ok).toBe(true);

    // Written to the physical per-mode node token.modeDark.surface, not the logical path.
    const disk = JSON.parse(await readFile(join(root, 'semantics.json'), 'utf8'));
    expect(disk.token.modeDark.surface.$value).toBe('#123123');
    expect(disk.token.modeLight.surface.$value).toBe('#ffffff'); // other mode untouched
    await pm.dispose();
  });
});

describe('tolerant typing', () => {
  it('loads PrimeNG-style untyped tokens without errors and infers types', async () => {
    await writeFile(join(root, 'transitions.json'), TRANSITIONS);
    const { config } = await loadConfig(root);
    const pm = new ProjectManager(root, config);
    await pm.load();

    const errors = pm.getDiagnostics().filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);

    const tokens = pm.getCollection('transitions')!.tokens;
    const fast = tokens.find((t) => t.path.join('.') === 'transition.fast')!;
    expect(fast.type).toBe('duration');
    const easing = tokens.find((t) => t.path.join('.') === 'transition.easing')!;
    expect(easing.type).toBe('unknown');
    await pm.dispose();
  });

  it('updateSettings(strict) surfaces missing-type and persists config', async () => {
    await writeFile(join(root, 'transitions.json'), TRANSITIONS);
    const { config } = await loadConfig(root);
    const pm = new ProjectManager(root, config);
    await pm.load();
    expect(pm.getDiagnostics().filter((d) => d.severity === 'error')).toHaveLength(0);

    await pm.updateSettings({ strictTypes: true, inferTypes: false });
    expect(pm.getDiagnostics().some((d) => d.code === 'missing-type')).toBe(true);

    // Persisted to disk.
    expect(existsSync(join(root, 'tokenflow.config.json'))).toBe(true);
    const written = JSON.parse(await readFile(join(root, 'tokenflow.config.json'), 'utf8'));
    expect(written.strictTypes).toBe(true);
    expect(written.collections.length).toBeGreaterThan(0);
    await pm.dispose();
  });
});
