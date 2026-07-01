import type { DistConfig, DistCollectionConfig, Output, ModeAxis, ModeStrategy } from '@tokenflow/shared';

/**
 * Phase 5 — topology auto-detection.
 *
 * Turns the project's parsed collections into a *proposed* deterministic-resolver
 * config: detects whether each collection's modes are nested (a path segment) or
 * file-based (one file per mode), and proposes an editable mode → selector map
 * (attribute selectors for brand/theme, `@media` for viewport). The wizard
 * hydrates from a saved config when present, else from this proposal.
 */

/** A normalized view of one project collection, fed to {@link proposeConfig}. */
export interface ProposeCollection {
  id: string;
  files: string[];
  /** Mode ids (path segments for nested; mode names for file-based). */
  modes: string[];
  topology: 'nested' | 'files' | 'none';
  /** Relative file → mode id (only for `topology === 'files'`). */
  fileModes?: Record<string, string>;
}

const VIEWPORT = /(mobile|tablet|desktop|phone|laptop|wide|width|screen|^(xs|sm|md|lg|xl|xxl)$)/i;
const THEME = /(light|dark|day|night|hc|contrast)/i;
const BRAND = /brand/i;

/** Strip a leading `mode` prefix and lowercase the first letter: `modeDark` → `dark`. */
function humanizeMode(mode: string): string {
  const m = mode.replace(/^mode(?=[A-Z])/, '');
  return m.charAt(0).toLowerCase() + m.slice(1);
}

/** Best `:root` default: light/default, then *1 (brand1/theme1), then mobile/base, then first. */
function pickDefault(modes: string[]): string {
  return (
    modes.find((m) => /light|default|base/i.test(m)) ??
    modes.find((m) => /(^|[^0-9])0*1$/.test(m)) ??
    modes.find((m) => /mobile|phone/i.test(m)) ??
    modes[0] ??
    ''
  );
}

/** A clean variable prefix from a (possibly path-like) collection id: `tokens/theme.tokens` → `theme-tokens`. */
function cleanPrefix(id: string): string {
  const base = id.split('/').pop() || id;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function axisName(modes: string[]): string {
  if (modes.some((m) => THEME.test(m))) return 'theme';
  if (modes.some((m) => VIEWPORT.test(m))) return 'viewport';
  if (modes.some((m) => BRAND.test(m))) return 'brand';
  return 'mode';
}

function strategyFor(modes: string[]): ModeStrategy {
  return modes.some((m) => VIEWPORT.test(m)) ? 'media' : 'selectors';
}

/** Guess a media condition for a viewport mode (user-editable). */
function mediaCondition(mode: string): string {
  if (/tablet|^md$/i.test(mode)) return '(min-width: 768px)';
  if (/desktop|laptop|^lg$/i.test(mode)) return '(min-width: 1280px)';
  if (/wide|xl|xxl/i.test(mode)) return '(min-width: 1536px)';
  return '(min-width: 768px)';
}

/** Build the mode → selector/condition map for an axis. */
function buildMap(modes: string[], def: string, strategy: ModeStrategy, name: string): Record<string, string> {
  const attr = name === 'theme' ? 'data-theme' : name === 'brand' ? 'data-brand' : `data-${name}`;
  const map: Record<string, string> = {};
  for (const m of modes) {
    if (m === def) map[m] = ':root';
    else if (strategy === 'media') map[m] = mediaCondition(m);
    else map[m] = `[${attr}='${humanizeMode(m)}']`;
  }
  return map;
}

function axisFor(c: ProposeCollection): ModeAxis | null {
  if (c.topology === 'none' || c.modes.length < 2) return null;
  const def = pickDefault(c.modes);
  const name = axisName(c.modes);
  const strategy = strategyFor(c.modes);
  const axis: ModeAxis = {
    name,
    source: c.topology === 'files' ? 'files' : 'nested',
    strategy,
    default: def,
    map: buildMap(c.modes, def, strategy, name),
  };
  if (c.topology === 'files' && c.fileModes) axis.fileMap = { ...c.fileModes };
  return axis;
}

/** Whether a collection should emit SCSS variables rather than CSS custom properties. */
function isScssCollection(id: string): boolean {
  return /break\s*points?/i.test(id);
}

/**
 * Propose a deterministic-resolver config from normalized project collections.
 * Collections carry topology only; outputs pick the format. By default we group
 * collections by their natural format into outputs: flat SCSS vars for
 * breakpoints-like collections, CSS variables for the rest — both to one folder.
 */
export function proposeConfig(
  collections: ProposeCollection[],
  opts: { sourceRoot?: string; destination?: string } = {},
): DistConfig {
  const out: DistCollectionConfig[] = collections.map((c) => {
    const axis = axisFor(c);
    return {
      id: c.id,
      prefix: cleanPrefix(c.id),
      preserveCase: isScssCollection(c.id),
      files: c.files,
      modeAxes: axis ? [axis] : [],
    };
  });

  const dest = opts.destination ?? 'src/styles/generated';
  const scssIds = collections.filter((c) => isScssCollection(c.id)).map((c) => c.id);
  const cssIds = collections.filter((c) => !isScssCollection(c.id)).map((c) => c.id);
  const outputs: Output[] = [];
  if (cssIds.length) outputs.push({ id: 'css', format: 'css-vars', destination: dest, collections: scssIds.length ? cssIds : 'all' });
  if (scssIds.length) outputs.push({ id: 'scss', format: 'scss-vars', destination: dest, collections: scssIds });
  if (!outputs.length) outputs.push({ id: 'css', format: 'css-vars', destination: dest, collections: 'all' });

  return { sourceRoot: opts.sourceRoot ?? '', manifest: true, collections: out, outputs };
}
