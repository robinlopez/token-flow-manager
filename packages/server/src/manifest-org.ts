import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFile } from '@tokenflow/core';
import {
  OrgManifestSchema,
  type CollectionConfig,
  type OrgManifest,
  type SetupIssue,
} from '@tokenflow/shared';

/**
 * `manifest.json`: organization source of truth (collections, modes, files per
 * mode), kept ISO with the Figma plugin that consumes it. This module maps the
 * manifest ↔ the tool's internal {@link CollectionConfig} model.
 *
 * Mapping rules (per collection `{ modes: { name: [files] } }`):
 *  - 1 mode               → single-mode collection (`files` only).
 *  - N modes, N distinct
 *    files (bijective)    → file-based modes (`fileModes`).
 *  - N modes sharing a
 *    file                 → path-segment modes (`modeDimension`): the dimension
 *                           is located by mode NAME then by COUNT (see
 *                           {@link detectModeSegments}), and the manifest's mode
 *                           names ride along as display labels (`modeLabels`),
 *                           matched to physical segments by normalized name then
 *                           position.
 */

export const ORG_MANIFEST_NAME = 'manifest.json';

/**
 * Internal mode id of a collection that declares no modes. Mirrors
 * `CollectionRuntime.defaultMode`'s fallback in `project.ts`.
 */
const IMPLICIT_MODE = 'default';

/** Relative manifest path if present at the project root, else null. */
export function detectOrgManifest(root: string): string | null {
  return existsSync(join(root, ORG_MANIFEST_NAME)) ? ORG_MANIFEST_NAME : null;
}

export async function readOrgManifestRaw(abs: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(abs, 'utf8')) as Record<string, unknown>;
}

export interface ParsedOrgManifest {
  collections: CollectionConfig[];
  /** Per-collection problems (e.g. declared modes that couldn't be located). */
  issues: SetupIssue[];
}

/** Normalize a mode name for matching: lowercase, drop a leading `mode` prefix. */
function normalizeMode(s: string): string {
  return s.toLowerCase().replace(/^mode[\s_-]?/, '').replace(/[\s_-]+/g, '');
}

/** Distinct segment values per depth, in first-appearance order. */
function segmentsByDepth(paths: string[][], includeLeaf: boolean): Map<number, string[]> {
  const byDepth = new Map<number, string[]>();
  const seenByDepth = new Map<number, Set<string>>();
  for (const p of paths) {
    const last = includeLeaf ? p.length : p.length - 1;
    for (let d = 0; d < last; d++) {
      let arr = byDepth.get(d);
      if (!arr) {
        arr = [];
        byDepth.set(d, arr);
        seenByDepth.set(d, new Set());
      }
      const seen = seenByDepth.get(d)!;
      const v = p[d]!;
      if (!seen.has(v)) {
        seen.add(v);
        arr.push(v);
      }
    }
  }
  return byDepth;
}

/**
 * Locate the path depth carrying the mode segment of a file shared across the
 * manifest's `modeNames`, returning those segments in first-appearance order.
 *
 * Two passes, in order of confidence:
 *  1. **By name**: the depth whose segments *are* the declared modes once
 *     normalized (`modeBaseline` ↔ `Baseline`). Only this pass can tell the mode
 *     dimension from a shallower level that merely happens to have as many
 *     groups: Material's `Font theme` has 2 modes and exactly 2 top groups
 *     (`static`, `tracking`), and counting alone folds the wrong one.
 *  2. **By count**: the shallowest depth with exactly as many distinct
 *     segments. Catches exports whose segment names carry no trace of the mode
 *     label at all.
 *
 * Each pass tries non-leaf depths first, since the last segment is normally the
 * token name, then the leaf: some exports do put the mode last
 * (`device.modeDesktop`, `device.modeTablet`… = one `device` variable with three
 * modes), and a manifest declaring N modes is explicit enough to trust.
 * Auto-detection never takes that step: it would be guessing.
 */
function detectModeSegments(
  paths: string[][],
  modeNames: string[],
): { dimension: number; segments: string[] } | null {
  const n = modeNames.length;
  const wanted = new Set(modeNames.map(normalizeMode));
  const matchesByName = (segs: string[]): boolean =>
    segs.length === n && segs.every((s) => wanted.has(normalizeMode(s)));

  for (const byName of [true, false]) {
    for (const includeLeaf of [false, true]) {
      const byDepth = segmentsByDepth(paths, includeLeaf);
      for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
        const segs = byDepth.get(d)!;
        if (byName ? matchesByName(segs) : segs.length === n) {
          return { dimension: d, segments: segs };
        }
      }
    }
  }
  return null;
}

/** Order physical `segments` to line up with `modeNames` (by normalized name, then position). */
function alignSegments(modeNames: string[], segments: string[]): string[] {
  const remaining = [...segments];
  return modeNames.map((name, i) => {
    const idx = remaining.findIndex((s) => normalizeMode(s) === normalizeMode(name));
    if (idx >= 0) return remaining.splice(idx, 1)[0]!;
    // Fall back to positional alignment for whatever is left.
    return remaining.length ? remaining.shift()! : segments[i] ?? name;
  });
}

/**
 * Parse a raw manifest into internal collection configs (reading token files to
 * locate shared-file mode dimensions). Returns any structural issues found.
 */
export async function parseOrgManifest(root: string, raw: unknown): Promise<ParsedOrgManifest> {
  const manifest: OrgManifest = OrgManifestSchema.parse(raw);
  const collections: CollectionConfig[] = [];
  const issues: SetupIssue[] = [];

  // Read + parse each referenced file once (token paths drive dimension detection).
  const pathCache = new Map<string, string[][]>();
  const pathsOf = async (rel: string, collection: string): Promise<string[][]> => {
    if (pathCache.has(rel)) return pathCache.get(rel)!;
    let paths: string[][] = [];
    try {
      const content = await readFile(join(root, rel), 'utf8');
      const { tokens } = parseFile(content, { file: rel, collection, modes: [], defaultMode: 'default' });
      paths = tokens.map((t) => t.path);
    } catch {
      /* missing/unparseable file → no paths (handled as an issue by the caller) */
    }
    pathCache.set(rel, paths);
    return paths;
  };

  for (const [name, col] of Object.entries(manifest.collections)) {
    const modeNames = Object.keys(col.modes);
    const distinctFiles = [...new Set(Object.values(col.modes).flat())];

    // 1) Single mode → plain single-mode collection. The declared name ("Default",
    //    "Baseline", "Value"…) rides along as the label of the implicit default
    //    mode, so the table header reads like Figma instead of `default`.
    if (modeNames.length <= 1) {
      const label = modeNames[0];
      collections.push({
        name,
        files: oneOrMany(distinctFiles),
        ...(label ? { modeLabels: { [IMPLICIT_MODE]: label } } : {}),
      });
      continue;
    }

    // 2) Bijective file-per-mode → file-based modes.
    const bijective =
      distinctFiles.length === modeNames.length &&
      modeNames.every((m) => col.modes[m]!.length === 1);
    if (bijective) {
      const fileModes: Record<string, string> = {};
      for (const m of modeNames) fileModes[col.modes[m]![0]!] = m;
      collections.push({ name, files: distinctFiles, modes: modeNames, fileModes });
      continue;
    }

    // 3) Shared file(s) → path-segment dimension, located by mode name then count.
    const sharedPaths = (await Promise.all(distinctFiles.map((f) => pathsOf(f, name)))).flat();
    const dim = detectModeSegments(sharedPaths, modeNames);
    if (!dim) {
      // Can't locate the modes inside the file(s): surface for onboarding and
      // fall back to a single-mode collection so the tokens still load.
      issues.push({
        code: 'mode-count-mismatch',
        collection: name,
        message: `Could not locate ${modeNames.length} modes (${modeNames.join(', ')}) inside ${distinctFiles.join(', ')}.`,
      });
      collections.push({ name, files: oneOrMany(distinctFiles) });
      continue;
    }
    const segments = alignSegments(modeNames, dim.segments);
    const modeLabels: Record<string, string> = {};
    segments.forEach((seg, i) => (modeLabels[seg] = modeNames[i]!));
    collections.push({
      name,
      files: oneOrMany(distinctFiles),
      modes: segments,
      modeDimension: dim.dimension,
      modeLabels,
    });
  }

  return { collections, issues };
}

/** A single string when there's one file, else the array (matches existing config style). */
function oneOrMany(files: string[]): string | string[] {
  return files.length === 1 ? files[0]! : files;
}

/**
 * Serialize internal collections back into a manifest object, round-tripping the
 * raw on-disk object so unknown keys survive. Inverse of {@link parseOrgManifest}:
 *  - `fileModes` → one file per mode;
 *  - `modeDimension` → each mode's display name (from `modeLabels`) → the file(s);
 *  - single-mode → `{ "<label>": [files] }`, keeping the name the manifest
 *    declared (falling back to `"Mode 1"` when there is none to keep).
 */
export function serializeOrgManifest(
  collections: CollectionConfig[],
  name: string,
  raw: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  out['name'] = name;
  const cols: Record<string, unknown> = {};
  for (const c of collections) {
    const files = Array.isArray(c.files) ? c.files : [c.files];
    const modes: Record<string, string[]> = {};
    if (c.fileModes && Object.keys(c.fileModes).length) {
      // One file per mode. Preserve declared mode order when available.
      const order = c.modes ?? [...new Set(Object.values(c.fileModes))];
      for (const mode of order) {
        const file = Object.entries(c.fileModes).find(([, m]) => m === mode)?.[0];
        modes[mode] = file ? [file] : files;
      }
    } else if (c.modes && c.modes.length > 1) {
      // Path-segment modes: emit the display label (or the segment id) → shared file(s).
      for (const seg of c.modes) modes[c.modeLabels?.[seg] ?? seg] = files;
    } else {
      const only = c.modes?.[0] ?? IMPLICIT_MODE;
      modes[c.modeLabels?.[only] ?? 'Mode 1'] = files;
    }
    cols[c.name] = { ...asRecord(asRecord(raw['collections'])[c.name]), modes };
  }
  out['collections'] = cols;
  return out;
}

export function serializeOrgManifestText(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
