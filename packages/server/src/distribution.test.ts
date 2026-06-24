import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@tokenflow/shared';
import { ProjectManager } from './project.js';
import { toManifestModel, mergeManifestIntoRaw, defaultManifest } from './distribution.js';
import { generateV5Script, detectSdVersion, type DistMatrix } from './distribution-v5.js';

const SAMPLE = JSON.stringify(
  { color: { $type: 'color', grey: { '50': { $value: '#fafafa' }, '900': { $value: '#111827' } } } },
  null,
  2,
);

const MANIFEST = {
  output: { useCssVariables: true, buildPath: 'src/styles/generated/', exportPrefix: 'myTheme' },
  themeMode: { mode: 'both', defaultTheme: 'themeOne', lightSelector: ':root', darkSelector: '.dark' },
  themes: [{ name: 'themeOne', primitiveFile: 'themeOne.json', objectName: 'themeOnePrimitives', customExtra: 7 }],
  tokens: { semantics: { enabled: true, sourceFile: 'src/design-tokens/semantics.json' } },
  structure: { tempDirectory: '.temp-tokens', sourceRoot: 'src/design-tokens' },
  comments: { fileHeader: '/* gen */' },
  // unknown top-level key must survive a round-trip
  customRoot: { keep: true },
};

describe('distribution — manifest adapter (pure)', () => {
  it('parses a token-config.json into the editable model', () => {
    const m = toManifestModel(MANIFEST);
    expect(m.output.exportPrefix).toBe('myTheme');
    expect(m.themeMode.mode).toBe('both');
    expect(m.themes[0]!.name).toBe('themeOne');
    expect(m.tokens['semantics']!.enabled).toBe(true);
  });

  it('preserves unknown keys when merging the edited model back', () => {
    const m = toManifestModel(MANIFEST);
    m.output.exportPrefix = 'changed';
    m.themeMode.mode = 'light';
    const merged = mergeManifestIntoRaw(MANIFEST, m);
    expect((merged['output'] as Record<string, unknown>)['exportPrefix']).toBe('changed');
    expect((merged['themeMode'] as Record<string, unknown>)['mode']).toBe('light');
    // unknown top-level + per-theme keys survive
    expect(merged['customRoot']).toEqual({ keep: true });
    expect((merged['themes'] as Record<string, unknown>[])[0]!['customExtra']).toBe(7);
  });

  it('builds a sensible default manifest from collections', () => {
    const dm = defaultManifest([{ name: 'Tokens', files: ['src/design-tokens/core.json'], modes: ['light', 'dark'] }]);
    expect(dm.themes.length).toBeGreaterThanOrEqual(1);
    expect(dm.tokens['Tokens']!.enabled).toBe(true);
    expect(dm.structure.sourceRoot).toBe('src/design-tokens');
  });
});

describe('distribution — Style Dictionary v5 generator (Phase 4 redesign)', () => {
  const matrix: DistMatrix = {
    sourceRoot: 'src/design-tokens',
    sources: [
      { id: 'primitives', label: 'Colors', wrapUnder: 'primitives', files: ['primitives/themeOne.json'],
        variants: [{ name: 'themeOne', file: 'primitives/themeOne.json' }, { name: 'themeTwo', file: 'primitives/themeTwo.json' }] },
      { id: 'semantics', label: 'Semantics', files: ['semantics.json'],
        variants: [{ name: 'modeLight' }, { name: 'modeDark' }] },
    ],
    targets: [
      { id: 'css', label: 'CSS', format: 'css/variables', destination: 'out/styles', sources: 'all',
        rendering: { semantics: { strategy: 'selectors', map: { modeLight: ':root', modeDark: '[data-theme=dark]' } } } },
      { id: 'ts', label: 'TS', format: 'javascript/es6', destination: 'out/tokens', sources: 'all' },
    ],
  };

  it('emits a self-contained v5 ESM script embedding the matrix', () => {
    const s = generateV5Script(matrix);
    expect(s).toContain("import StyleDictionary from 'style-dictionary'");
    expect(s).toContain('usesDtcg: true'); // DTCG-native (no $value stripping)
    expect(s).toContain('tfm/kebab'); // CSS naming drops mode segment
    expect(s).toContain('tfm/camel'); // JS naming = valid identifier
    expect(s).toContain('"sourceRoot": "src/design-tokens"'); // matrix embedded
    expect(s).not.toContain('require('); // pure ESM
  });

  it('opts into @tokens-studio/sd-transforms only when requested', () => {
    expect(generateV5Script(matrix)).not.toContain('@tokens-studio/sd-transforms');
    expect(generateV5Script({ ...matrix, tokensStudio: true })).toContain('@tokens-studio/sd-transforms');
  });

  it('writes the v5 script + npm script + matrix sidecar, and restores savedMatrix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tfm-w-'));
    try {
      await mkdir(join(root, 'tokens'), { recursive: true });
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'w', scripts: {} }));
      await writeFile(join(root, 'tokens/colors.json'), JSON.stringify({ color: { fg: { $type: 'color', $value: '#000' } } }));
      const pm = new ProjectManager(root, DEFAULT_CONFIG);
      await pm.load();
      const m: DistMatrix = {
        sourceRoot: 'tokens',
        sources: [{ id: 'c', label: 'Colors', files: ['colors.json'], variants: [] }],
        targets: [{ id: 'css', label: 'CSS', format: 'css/variables', destination: 'out', sources: 'all' }],
      };
      const res = await pm.writeDistribution(m);
      expect(res.ok).toBe(true);
      expect(existsSync(join(root, res.scriptPath))).toBe(true);
      expect(res.npmAdded).toBe(true);
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      expect(pkg.scripts[res.npmScript.name]).toBe(res.npmScript.command);
      expect(existsSync(join(root, '.tokenflow/distribution.json'))).toBe(true);
      // The generated script needs style-dictionary v5 — added to devDependencies.
      expect(res.addedDependencies).toContain('style-dictionary@^5.0.0');
      expect(pkg.devDependencies['style-dictionary']).toBe('^5.0.0');

      // A second write is idempotent: SD already present → nothing re-added.
      const res2 = await pm.writeDistribution(m);
      expect(res2.addedDependencies).toEqual([]);

      // Reopening restores the saved matrix from the sidecar.
      const pm2 = new ProjectManager(root, DEFAULT_CONFIG);
      await pm2.load();
      const state = await pm2.getDistribution();
      expect((state.savedMatrix as DistMatrix).sources[0]!.id).toBe('c');
      expect(state.v5ScriptPath).toBe('scripts/tokens.build.mjs');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('detects no Style Dictionary in an empty project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tfm-sd-'));
    try {
      expect(detectSdVersion(root)).toEqual({ installed: null, mode: 'none' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('test-build produces files for a clean set and reports a broken reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tfm-tb-'));
    try {
      await mkdir(join(root, 'tokens'), { recursive: true });
      await writeFile(join(root, 'package.json'), '{"name":"tb"}');
      await writeFile(
        join(root, 'tokens/colors.json'),
        JSON.stringify({ color: { fg: { $type: 'color', $value: '#000' }, bg: { $type: 'color', $value: '{color.fg}' } } }),
      );
      const pm = new ProjectManager(root, DEFAULT_CONFIG);
      await pm.load();
      const m: DistMatrix = {
        sourceRoot: 'tokens',
        sources: [{ id: 'c', label: 'Colors', files: ['colors.json'], variants: [] }],
        targets: [{ id: 'css', label: 'CSS', format: 'css/variables', destination: 'out', sources: 'all' }],
      };
      const clean = await pm.testBuildDistribution(m);
      expect(clean.ok).toBe(true);
      expect(clean.outputs.length).toBeGreaterThan(0);
      // The project is never written to (sandbox isolation).
      expect(existsSync(join(root, 'out'))).toBe(false);

      // Break the reference → reported as an error, ok=false.
      await writeFile(
        join(root, 'tokens/colors.json'),
        JSON.stringify({ color: { bg: { $type: 'color', $value: '{color.missing}' } } }),
      );
      await pm.reload();
      const broken = await pm.testBuildDistribution(m);
      expect(broken.ok).toBe(false);
      expect(broken.diagnostics.some((d) => d.level === 'error' && /not defined|reference/i.test(d.message))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('ProjectManager — distribution lifecycle', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tfm-dist-'));
    await writeFile(join(root, 'app.tokens.json'), SAMPLE + '\n');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports no manifest before init, then scaffolds one + the build script', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: {} }, null, 2));
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const before = await pm.getDistribution();
    expect(before.manifest).toBeNull();
    expect(before.exists).toBe(false);

    const after = await pm.initDistribution(true);
    expect(after.exists).toBe(true);
    expect(after.manifest).not.toBeNull();
    expect(existsSync(join(root, 'token-config.json'))).toBe(true);
    expect(existsSync(join(root, 'scripts/build-tokens-sd.js'))).toBe(true);

    // npm script was added.
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['generate:tokens']).toContain('build-tokens-sd.js');
  });

  it('round-trips an edited manifest and preserves unknown keys', async () => {
    await writeFile(join(root, 'token-config.json'), JSON.stringify(MANIFEST, null, 2) + '\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const state = await pm.getDistribution();
    expect(state.manifestPath).toBe('token-config.json');
    const model = state.manifest!;
    model.output.exportPrefix = 'edited';
    model.themeMode.darkSelector = '[data-theme=dark]';

    const next = await pm.updateManifest(model);
    expect(next.manifest?.output.exportPrefix).toBe('edited');

    const onDisk = JSON.parse(await readFile(join(root, 'token-config.json'), 'utf8'));
    expect(onDisk.output.exportPrefix).toBe('edited');
    expect(onDisk.themeMode.darkSelector).toBe('[data-theme=dark]');
    expect(onDisk.customRoot).toEqual({ keep: true }); // unknown key survived
    expect(onDisk.themes[0].customExtra).toBe(7);
  });

  it('embedded build script template is valid, root-relative JS', async () => {
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    await mkdir(join(root, 'scripts'), { recursive: true });
    await pm.scaffoldBuildScript();
    const script = await readFile(join(root, 'scripts/build-tokens-sd.js'), 'utf8');
    expect(script).toContain("require('style-dictionary')");
    expect(script).toContain('token-config.json'); // resolves the manifest at the root
    expect(script).toContain('SOURCE_ROOT');
  });

  it('detects SD version, npm scripts and configs at the package root when opened on a tokens subfolder', async () => {
    // Real project root: package.json + a v3 style-dictionary install + a root config.
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { 'generate:tokens': 'node build.js' } }, null, 2));
    await writeFile(join(root, 'token-config.json'), '{}\n');
    await mkdir(join(root, 'node_modules/style-dictionary'), { recursive: true });
    await writeFile(join(root, 'node_modules/style-dictionary/package.json'), JSON.stringify({ version: '3.9.2' }));
    // User opens the tokens subfolder, not the project root.
    const tokensDir = join(root, 'src/design-tokens');
    await mkdir(tokensDir, { recursive: true });
    await writeFile(join(tokensDir, 'app.tokens.json'), SAMPLE + '\n');

    const pm = new ProjectManager(tokensDir, DEFAULT_CONFIG);
    await pm.load();
    const state = await pm.getDistribution();

    expect(state.sdVersion).toEqual({ installed: 3, mode: 'v3' });
    expect(state.npmScripts.some((s) => s.name === 'generate:tokens')).toBe(true);
    expect(state.detectedConfigs).toContain('token-config.json');
  });

  it('links / unlinks an external build via the sidecar, routing to overview', async () => {
    await writeFile(join(root, 'sd.config.json'), '{}\n');
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    // The config file is detected as a candidate before linking.
    const before = await pm.getDistribution();
    expect(before.linked).toBeNull();
    expect(before.detectedConfigs).toContain('sd.config.json');
    // projectId scopes client drafts so they never leak across projects.
    expect(before.projectId).toBe(root);

    const linked = await pm.linkExisting({ configPath: 'sd.config.json', buildCommand: 'npm run gen' });
    expect(linked.linked).toEqual({ configPath: 'sd.config.json', buildCommand: 'npm run gen' });
    expect(existsSync(join(root, '.tokenflow/distribution-link.json'))).toBe(true);

    // Reopening restores the pointer (routes to overview on the client).
    const reopened = await new ProjectManager(root, DEFAULT_CONFIG);
    await reopened.load();
    expect((await reopened.getDistribution()).linked?.buildCommand).toBe('npm run gen');

    const unlinked = await pm.unlinkExisting();
    expect(unlinked.linked).toBeNull();
    expect(existsSync(join(root, '.tokenflow/distribution-link.json'))).toBe(false);
  });

  it('runs the project command and maps stdout diagnostics + produced files into a report', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo' }, null, 2));
    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();

    const ok = await pm.runProjectCommand('echo built ok');
    expect(ok.ok).toBe(true);
    expect(ok.diagnostics).toEqual([]);

    // A real file echoed in the output is surfaced (confirmed on disk) with its size.
    await mkdir(join(root, 'out'), { recursive: true });
    await writeFile(join(root, 'out/theme.css'), ':root{--x:1}\n');
    const built = await pm.runProjectCommand('echo "✔︎ out/theme.css"');
    expect(built.outputs.some((o) => o.file === 'out/theme.css' && o.bytes > 0)).toBe(true);

    // A broken-reference line is surfaced as an error diagnostic + ok=false.
    const bad = await pm.runProjectCommand("echo \"reference doesn't exist: {missing.token}\"");
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.level === 'error')).toBe(true);

    // A non-zero exit downgrades the report even without a recognised line.
    const crash = await pm.runProjectCommand('exit 3');
    expect(crash.ok).toBe(false);
  });
});
