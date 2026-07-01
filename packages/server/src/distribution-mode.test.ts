import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DistConfigSchema, DistMatrixSchema } from '@tokenflow/shared';
import { ProjectManager } from './project.js';
import { loadConfig } from './config-loader.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-mode-'));
  // pkgRoot detection + npm-script / dependency edits need a package.json at the root.
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }, null, 2) + '\n');
  // A token file so a collection is detected (the wizards need collections).
  await writeFile(
    join(root, 'app.tokens.json'),
    JSON.stringify({ color: { $type: 'color', brand: { $value: '#123456' } } }, null, 2) + '\n',
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

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

const emptyConfig = () => DistConfigSchema.parse({});
const emptyMatrix = () => DistMatrixSchema.parse({ sourceRoot: '', sources: [], targets: [] });

const MODE_FILE = '.tokenflow/distribution.mode.json';
const CONFIG_SIDECAR = '.tokenflow/distribution.config.json';
const MATRIX_SIDECAR = '.tokenflow/distribution.json';
const LINK_SIDECAR = '.tokenflow/distribution-link.json';

async function readMode(): Promise<string | null> {
  try {
    return (JSON.parse(await readFile(join(root, MODE_FILE), 'utf8')) as { mode: string }).mode;
  } catch {
    return null;
  }
}

describe('Distribution — active mode detection', () => {
  it('reports `none` when nothing is configured', async () => {
    const pm = await openProject();
    const state = await pm.getDistribution();
    expect(state.activeMode).toBe('none');
  });

  it('writeResolver sets the active mode to `resolver` + writes the mode file', async () => {
    const pm = await openProject();
    await pm.writeResolver(emptyConfig());
    expect((await pm.getDistribution()).activeMode).toBe('resolver');
    expect(await readMode()).toBe('resolver');
    expect(existsSync(join(root, CONFIG_SIDECAR))).toBe(true);
  });

  it('writeDistribution sets the active mode to `style-dictionary`', async () => {
    const pm = await openProject();
    await pm.writeDistribution(emptyMatrix());
    expect((await pm.getDistribution()).activeMode).toBe('style-dictionary');
    expect(await readMode()).toBe('style-dictionary');
  });

  it('linkExisting sets the active mode to `linked`', async () => {
    const pm = await openProject();
    await pm.linkExisting({ configPath: '', buildCommand: 'npm run tokens' });
    expect((await pm.getDistribution()).activeMode).toBe('linked');
    expect(await readMode()).toBe('linked');
  });

  it('infers by priority (resolver > style-dictionary > linked) when the mode file is absent', async () => {
    await mkdir(join(root, '.tokenflow'), { recursive: true });
    await writeFile(join(root, CONFIG_SIDECAR), '{}');
    await writeFile(join(root, MATRIX_SIDECAR), '{}');
    await writeFile(join(root, LINK_SIDECAR), JSON.stringify({ buildCommand: 'x' }));

    const pm = await openProject();
    expect((await pm.getDistribution()).activeMode).toBe('resolver');

    await rm(join(root, CONFIG_SIDECAR));
    expect((await pm.getDistribution()).activeMode).toBe('style-dictionary');

    await rm(join(root, MATRIX_SIDECAR));
    expect((await pm.getDistribution()).activeMode).toBe('linked');
  });

  it('the explicit mode file wins over sidecar inference', async () => {
    await mkdir(join(root, '.tokenflow'), { recursive: true });
    // On-disk sidecars would infer `resolver`, but the mode file says `linked`.
    await writeFile(join(root, CONFIG_SIDECAR), '{}');
    await writeFile(join(root, MODE_FILE), JSON.stringify({ mode: 'linked' }));

    const pm = await openProject();
    expect((await pm.getDistribution()).activeMode).toBe('linked');
  });
});

describe('Distribution — switching mode with cleanup', () => {
  it('resolver → style-dictionary with cleanPrevious removes the resolver sidecar', async () => {
    const pm = await openProject();
    await pm.writeResolver(emptyConfig());
    expect(existsSync(join(root, CONFIG_SIDECAR))).toBe(true);

    await pm.writeDistribution(emptyMatrix(), true);
    expect((await pm.getDistribution()).activeMode).toBe('style-dictionary');
    expect(existsSync(join(root, CONFIG_SIDECAR))).toBe(false);
    // Style Dictionary was added as a devDependency by the SD write.
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.['style-dictionary']).toBeTruthy();
  });

  it('style-dictionary → resolver with cleanPrevious removes the matrix sidecar + the style-dictionary dep', async () => {
    const pm = await openProject();
    await pm.writeDistribution(emptyMatrix());
    expect(existsSync(join(root, MATRIX_SIDECAR))).toBe(true);

    await pm.writeResolver(emptyConfig(), true);
    expect((await pm.getDistribution()).activeMode).toBe('resolver');
    expect(existsSync(join(root, MATRIX_SIDECAR))).toBe(false);
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.['style-dictionary']).toBeUndefined();
  });

  it('without cleanPrevious the previous sidecar survives (but the active mode still switches)', async () => {
    const pm = await openProject();
    await pm.writeResolver(emptyConfig());
    await pm.writeDistribution(emptyMatrix()); // no cleanup

    expect((await pm.getDistribution()).activeMode).toBe('style-dictionary');
    expect(existsSync(join(root, CONFIG_SIDECAR))).toBe(true);
  });

  it('unlink re-infers the active mode from a surviving managed sidecar', async () => {
    const pm = await openProject();
    await pm.writeResolver(emptyConfig());
    await pm.linkExisting({ configPath: '', buildCommand: 'npm run tokens' }); // no cleanup
    expect((await pm.getDistribution()).activeMode).toBe('linked');

    await pm.unlinkExisting();
    // The resolver sidecar still exists → active mode falls back to it.
    expect((await pm.getDistribution()).activeMode).toBe('resolver');
  });
});
