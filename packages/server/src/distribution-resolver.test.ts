import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, matrixToConfig, type DistConfig, type DistCollectionConfig, type DistBuildReport, type DistMatrix } from '@tokenflow/shared';
import { runResolverBuild } from './distribution-resolver.js';
import { proposeConfig, type ProposeCollection } from './distribution-propose.js';
import { ProjectManager } from './project.js';

// Each test authors token JSON in a temp project, runs the *real* generated
// script (sandboxed), and inspects the produced files + diagnostics.

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-resolver-test-'));
  await mkdir(join(root, 'tokens'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

async function write(file: string, json: unknown): Promise<void> {
  await writeFile(join(root, 'tokens', file), JSON.stringify(json, null, 2));
}

type Fmt = 'css-vars' | 'scss-vars' | 'scss-mixin' | 'ts' | 'json';
/** Single-output config covering all collections, in the given format, to `out/`. */
function config(collections: DistCollectionConfig[], format: Fmt = 'css-vars'): DistConfig {
  return { sourceRoot: 'tokens', manifest: true, collections, outputs: [{ id: 'o', format, destination: 'out', collections: 'all' }] };
}

async function build(cfg: DistConfig): Promise<{ report: DistBuildReport; byFile: Record<string, string> }> {
  const report = await runResolverBuild(root, cfg, Date.now());
  const byFile: Record<string, string> = {};
  // Key by basename for convenience (tests use single-destination configs).
  for (const o of report.outputs) if (o.content !== undefined) byFile[o.file.split('/').pop()!] = o.content;
  return { report, byFile };
}

const color = (v: string) => ({ $type: 'color', $value: v });
const dim = (v: string) => ({ $type: 'dimension', $value: v });

describe('deterministic resolver', () => {
  it('A (nested) and B (multi-file) topologies produce identical output', async () => {
    const brandAxisNested = {
      name: 'brand',
      source: 'nested' as const,
      strategy: 'selectors' as const,
      default: 'modeBrand1',
      map: { modeBrand1: ':root', modeBrand2: "[data-brand='brand2']" },
    };

    // Topology A — one merged file, modes nested in each token.
    await write('primitives.json', {
      grey: { modeBrand1: { '900': color('#111') }, modeBrand2: { '900': color('#222') } },
      blue: { modeBrand1: { '500': color('#00f') }, modeBrand2: { '500': color('#11f') } },
      white: color('#fff'),
    });
    const a = await build(
      config([{ id: 'primitives', prefix: 'primitives', preserveCase: false, files: ['primitives.json'], modeAxes: [brandAxisNested] }]),
    );
    expect(a.report.ok).toBe(true);
    const aCss = a.byFile['_tokens-primitives.scss'];

    // Topology B — one file per brand; same tokens, mode-free names.
    await write('primitives.brand1.json', { grey: { '900': color('#111') }, blue: { '500': color('#00f') }, white: color('#fff') });
    await write('primitives.brand2.json', { grey: { '900': color('#222') }, blue: { '500': color('#11f') } });
    const b = await build(
      config([
        {
          id: 'primitives', prefix: 'primitives', preserveCase: false,
          files: ['primitives.brand1.json', 'primitives.brand2.json'],
          modeAxes: [{ ...brandAxisNested, source: 'files', fileMap: { 'primitives.brand1.json': 'modeBrand1', 'primitives.brand2.json': 'modeBrand2' } }],
        },
      ]),
    );
    expect(b.report.ok).toBe(true);
    const bCss = b.byFile['_tokens-primitives.scss'];

    expect(aCss).toBe(bCss); // diff = 0, the headline acceptance criterion
    expect(aCss).toContain("[data-brand='brand2']");
  });

  it('emits a no-mode token exactly once, in :root', async () => {
    await write('primitives.json', {
      grey: { modeBrand1: { '900': color('#111') }, modeBrand2: { '900': color('#222') } },
      white: color('#fff'),
    });
    const { byFile } = await build(
      config([{ id: 'primitives', prefix: 'primitives', preserveCase: false, files: ['primitives.json'], modeAxes: [{ name: 'brand', source: 'nested', strategy: 'selectors', default: 'modeBrand1', map: { modeBrand1: ':root', modeBrand2: "[data-brand='brand2']" } }] }]),
    );
    const css = byFile['_tokens-primitives.scss']!;
    expect(css.match(/--primitives-white\b/g)?.length).toBe(1);
    // white must live under :root, not the brand2 block
    expect(css.split("[data-brand='brand2']")[1]).not.toContain('--primitives-white');
  });

  it('resolves cross-collection references to var(--…) (outputReferences)', async () => {
    await write('metrics.json', { units: { sm: dim('4px') } });
    await write('semantics.json', { gap: { inline: { $type: 'dimension', $value: '{metrics.units.sm}' } } });
    const { report, byFile } = await build(
      config([
        { id: 'metrics', prefix: 'metrics', preserveCase: false, files: ['metrics.json'], modeAxes: [] },
        { id: 'semantics', prefix: '', preserveCase: false, files: ['semantics.json'], modeAxes: [] },
      ]),
    );
    expect(report.ok).toBe(true);
    expect(byFile['_tokens-semantics.scss']).toContain('--gap-inline: var(--metrics-units-sm);');
  });

  it('flags a broken reference as a warning and never leaks a raw {token}', async () => {
    await write('semantics.json', { gap: { inline: { $type: 'dimension', $value: '{missing.token}' } } });
    const { report, byFile } = await build(
      config([{ id: 'semantics', prefix: '', preserveCase: false, files: ['semantics.json'], modeAxes: [] }]),
    );
    expect(report.diagnostics.some((d) => d.level === 'warn' && d.reference === 'missing.token')).toBe(true);
    const css = byFile['_tokens-semantics.scss']!;
    expect(css).toContain('/* unresolved: missing.token */');
    expect(css).not.toContain('{missing.token}');
  });

  it('renders a viewport axis as @media, with the default mode in :root', async () => {
    await write('responsive.json', {
      screen: { modeMobile: { gap: dim('8px') }, modeTablet: { gap: dim('16px') } },
    });
    const { byFile } = await build(
      config([{ id: 'responsive', prefix: '', preserveCase: false, files: ['responsive.json'], modeAxes: [{ name: 'viewport', source: 'nested', strategy: 'media', default: 'modeMobile', map: { modeTablet: '(min-width: 600px)' } }] }]),
    );
    const css = byFile['_tokens-responsive.scss']!;
    expect(css).toMatch(/:root \{\n\s*--screen-gap: 8px;/);
    expect(css).toContain('@media (min-width: 600px) {');
    expect(css).toMatch(/@media \(min-width: 600px\) \{\n\s*:root \{\n\s*--screen-gap: 16px;/);
  });

  it('flattens composite token values into sub-variables (never a raw JSON blob)', async () => {
    await write('typo.json', { text: { heading: { $type: 'typography', $value: { fontFamily: 'Inter', fontWeight: 700, lineHeight: 1.2 } } } });
    const { byFile } = await build(
      config([{ id: 'typo', prefix: 'typo', preserveCase: false, files: ['typo.json'], modeAxes: [] }]),
    );
    const css = byFile['_tokens-typo.scss']!;
    expect(css).toContain('--typo-text-heading-fontfamily: Inter;');
    expect(css).toContain('--typo-text-heading-fontweight: 700;');
    expect(css).toContain('--typo-text-heading-lineheight: 1.2;');
    expect(css).not.toContain('"fontFamily"'); // no JSON leaked into the value
  });

  it('emits a SCSS mixin theme map (brand × light/dark) with :root default + activation classes', async () => {
    // Two nested axes: brand (selectors) and theme (light/dark, selectors).
    await write('semantics.json', {
      surface: {
        modeBrand1: { modeLight: { bg: color('#fff') }, modeDark: { bg: color('#000') } },
        modeBrand2: { modeLight: { bg: color('#eee') }, modeDark: { bg: color('#111') } },
      },
    });
    const { report, byFile } = await build(
      config([{
        id: 'semantics', prefix: 'sem', preserveCase: false, files: ['semantics.json'],
        modeAxes: [
          { name: 'brand', source: 'nested', strategy: 'selectors', default: 'modeBrand1', map: { modeBrand1: ':root', modeBrand2: "[data-brand='brand2']" } },
          { name: 'theme', source: 'nested', strategy: 'selectors', default: 'modeLight', map: { modeLight: ':root', modeDark: "[data-theme='dark']" } },
        ],
      }], 'scss-mixin'),
    );
    expect(report.ok).toBe(true);
    const scss = byFile['_tokens-semantics.scss']!;
    expect(scss).toContain('$sem-themes: (');
    expect(scss).toContain('"modeBrand1": (');
    expect(scss).toContain('"modeLight": (');
    expect(scss).toContain('"sem-surface-bg": #fff,');
    expect(scss).toContain('@mixin sem-apply($name) {');
    expect(scss).toContain('@include sem-apply("modeBrand1");'); // default brand at :root
    expect(scss).toContain('--#{$n}: #{$v};');
    expect(scss).toContain('._#{to-lower-case($name)}'); // per-brand activation classes
    // dark overrides are nested, not duplicated into :root base
    expect(scss).toContain("[data-theme='dark']");
  });

  it('emits TypeScript with modes as nested keys and references inlined to literals', async () => {
    await write('primitives.json', { grey: { '900': color('#111827') } });
    await write('semantics.json', { text: { default: { $type: 'color', $value: '{primitives.grey.900}' } } });
    const { byFile } = await build(
      config([
        { id: 'primitives', prefix: 'primitives', preserveCase: false, files: ['primitives.json'], modeAxes: [] },
        { id: 'semantics', prefix: 'sem', preserveCase: false, files: ['semantics.json'], modeAxes: [] },
      ], 'ts'),
    );
    const ts = byFile['semantics.ts']!;
    expect(ts).toContain('export const sem =');
    expect(ts).toContain('"default": "#111827"'); // reference inlined to the literal value
    expect(ts).not.toContain('var(--'); // not a CSS var in TS
    expect(ts).not.toContain('{primitives'); // no raw reference
  });

  it('writes each output to its own destination (SCSS + TS in different folders)', async () => {
    await write('primitives.json', { grey: { '900': color('#111') } });
    const report = await runResolverBuild(root, {
      sourceRoot: 'tokens', manifest: false,
      collections: [{ id: 'primitives', prefix: 'primitives', preserveCase: false, files: ['primitives.json'], modeAxes: [] }],
      outputs: [
        { id: 'scss', format: 'css-vars', destination: 'styles/generated', collections: 'all' },
        { id: 'ts', format: 'ts', destination: 'core/tokens', collections: 'all' },
      ],
    }, Date.now());
    const files = report.outputs.map((o) => o.file);
    expect(files).toContain('styles/generated/_tokens-primitives.scss');
    expect(files).toContain('core/tokens/primitives.ts');
  });

  it('emits SCSS breakpoints with preserved case and 0 instead of 0px', async () => {
    await write('breakpoints.json', { phone: dim('0px'), tabletPortrait: dim('600px') });
    const { byFile } = await build(
      config([{ id: 'breakpoints', prefix: 'breakpoint', preserveCase: true, files: ['breakpoints.json'], modeAxes: [] }], 'scss-vars'),
    );
    const scss = byFile['_tokens-breakpoints.scss']!;
    expect(scss).toContain('$breakpoint-phone: 0;');
    expect(scss).toContain('$breakpoint-tabletPortrait: 600px;');
  });
});

describe('resolver — migration', () => {
  it('migrates a legacy file-variant matrix into a files-axis collection', () => {
    const matrix: DistMatrix = {
      sourceRoot: 'tokens',
      sources: [
        {
          id: 'primitives', label: 'Primitives', files: ['p.brand1.json', 'p.brand2.json'], wrapUnder: 'primitives',
          variants: [{ name: 'brand1', file: 'p.brand1.json' }, { name: 'brand2', file: 'p.brand2.json' }],
        },
      ],
      targets: [
        {
          id: 'css', label: 'CSS', format: 'css/variables', destination: 'src/styles/gen', prefix: 'primitives', sources: 'all',
          rendering: { primitives: { strategy: 'selectors', map: { brand2: "[data-brand='brand2']" } } },
        },
      ],
    };
    const cfg = matrixToConfig(matrix);
    expect(cfg.outputs[0]!.destination).toBe('src/styles/gen');
    expect(cfg.outputs[0]!.format).toBe('css-vars');
    expect(cfg.collections).toHaveLength(1);
    const c = cfg.collections[0]!;
    expect(c.prefix).toBe('primitives');
    const axis = c.modeAxes[0]!;
    expect(axis.source).toBe('files');
    expect(axis.strategy).toBe('selectors');
    expect(axis.fileMap).toEqual({ 'p.brand1.json': 'brand1', 'p.brand2.json': 'brand2' });
    expect(axis.default).toBe('brand1'); // brand1 wins as the :root default
  });
});

describe('resolver — topology proposal', () => {
  const propose = (c: ProposeCollection) => proposeConfig([c]).collections[0]!;

  it('proposes a nested selectors axis for brand modes', () => {
    const c = propose({ id: 'primitives', files: ['primitives.json'], modes: ['modeBrand1', 'modeBrand2', 'modeBrand3'], topology: 'nested' });
    const a = c.modeAxes[0]!;
    expect(a.source).toBe('nested');
    expect(a.strategy).toBe('selectors');
    expect(a.name).toBe('brand');
    expect(a.default).toBe('modeBrand1');
    expect(a.map['modeBrand1']).toBe(':root');
    expect(a.map['modeBrand2']).toBe("[data-brand='brand2']");
  });

  it('proposes a files axis for file-based theme modes, carrying the fileMap', () => {
    const c = propose({
      id: 'semantics', files: ['sem.light.json', 'sem.dark.json'], modes: ['light', 'dark'],
      topology: 'files', fileModes: { 'sem.light.json': 'light', 'sem.dark.json': 'dark' },
    });
    const a = c.modeAxes[0]!;
    expect(a.source).toBe('files');
    expect(a.name).toBe('theme');
    expect(a.default).toBe('light');
    expect(a.map['dark']).toBe("[data-theme='dark']");
    expect(a.fileMap).toEqual({ 'sem.light.json': 'light', 'sem.dark.json': 'dark' });
  });

  it('proposes a @media axis for viewport modes with mobile as :root', () => {
    const c = propose({ id: 'responsive', files: ['responsive.json'], modes: ['mobile', 'tablet', 'desktop'], topology: 'nested' });
    const a = c.modeAxes[0]!;
    expect(a.strategy).toBe('media');
    expect(a.name).toBe('viewport');
    expect(a.default).toBe('mobile');
    expect(a.map['mobile']).toBe(':root');
    expect(a.map['tablet']).toBe('(min-width: 768px)');
    expect(a.map['desktop']).toBe('(min-width: 1280px)');
  });

  it('proposes a scss-vars output + preserveCase for a breakpoints collection, and no axis', () => {
    const cfg = proposeConfig([{ id: 'breakpoints', files: ['breakpoints.json'], modes: [], topology: 'none' }]);
    expect(cfg.outputs.some((o) => o.format === 'scss-vars')).toBe(true);
    expect(cfg.collections[0]!.preserveCase).toBe(true);
    expect(cfg.collections[0]!.modeAxes).toEqual([]);
  });

  it('proposes no axis for a collection without modes', () => {
    const c = propose({ id: 'metrics', files: ['metrics.json'], modes: [], topology: 'none' });
    expect(c.modeAxes).toEqual([]);
    expect(c.prefix).toBe('metrics');
  });
});

describe('ProjectManager — resolver lifecycle', () => {
  it('writes the resolver script + npm script + config sidecar, with no SD deps, and restores savedConfig', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'w', scripts: {} }));
    await write('colors.json', { color: { fg: color('#000') } });
    const cfg: DistConfig = {
      sourceRoot: 'tokens', manifest: true,
      collections: [{ id: 'colors', prefix: '', preserveCase: false, files: ['colors.json'], modeAxes: [] }],
      outputs: [{ id: 'o', format: 'css-vars', destination: 'out', collections: 'all' }],
    };

    const pm = new ProjectManager(root, DEFAULT_CONFIG);
    await pm.load();
    const res = await pm.writeResolver(cfg);
    expect(res.ok).toBe(true);
    expect(res.scriptPath).toBe('scripts/tokens.build.mjs');
    expect(existsSync(join(root, res.scriptPath))).toBe(true);
    expect(existsSync(join(root, '.tokenflow/distribution.config.json'))).toBe(true);
    expect(res.addedDependencies).toEqual([]); // resolver has no runtime deps

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts[res.npmScript.name]).toBe(res.npmScript.command);
    expect(pkg.devDependencies?.['style-dictionary']).toBeUndefined();

    // Reopening restores the config from the new sidecar.
    const pm2 = new ProjectManager(root, DEFAULT_CONFIG);
    await pm2.load();
    const state = await pm2.getDistribution();
    expect(state.savedConfig?.collections[0]?.id).toBe('colors');
  }, 20_000);
});
