import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOrgManifest, serializeOrgManifest } from './manifest-org.js';

/**
 * How `manifest.json` maps onto collections and modes. These cases pin the three
 * rules the starter templates exposed; each one used to mis-map a real export.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tf-manifest-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const color = (v: string) => ({ $type: 'color', $value: v });

describe('parseOrgManifest: locating the mode dimension', () => {
  it('prefers the depth whose segments ARE the declared modes over a shallower same-count depth', async () => {
    // Two declared modes, and exactly two top-level groups. Counting alone folds
    // `static`/`tracking` (Material's `Font theme`); matching by name folds the
    // real mode segment one level down.
    await writeFile(
      join(dir, 'fontTheme.json'),
      JSON.stringify({
        static: {
          modeBaseline: { weight: { bold: color('#000') } },
          modeWireframe: { weight: { bold: color('#111') } },
        },
        tracking: {
          modeBaseline: { none: color('#222') },
          modeWireframe: { none: color('#333') },
        },
      }),
    );

    const { collections, issues } = await parseOrgManifest(dir, {
      name: 'Design Tokens',
      collections: {
        'Font theme': { modes: { Baseline: ['fontTheme.json'], Wireframe: ['fontTheme.json'] } },
      },
    });

    expect(issues).toEqual([]);
    const col = collections[0]!;
    expect(col.modeDimension).toBe(1);
    expect(col.modes).toEqual(['modeBaseline', 'modeWireframe']);
    expect(col.modeLabels).toEqual({ modeBaseline: 'Baseline', modeWireframe: 'Wireframe' });
  });

  it('accepts a mode that sits on the last path segment', async () => {
    // `device.modeDesktop` is one `device` variable with three modes, not three
    // variables. The leaf is normally the token name, so it is only considered
    // once no inner depth matches (the manifest declaring N modes is the licence).
    await writeFile(
      join(dir, 'responsive.json'),
      JSON.stringify({
        device: { modeDesktop: color('#1'), modeTablet: color('#2'), modeMobile: color('#3') },
        scale: { modeDesktop: color('#4'), modeTablet: color('#5'), modeMobile: color('#6') },
      }),
    );

    const { collections, issues } = await parseOrgManifest(dir, {
      name: 'Design Tokens',
      collections: {
        Responsive: {
          modes: {
            Desktop: ['responsive.json'],
            Mobile: ['responsive.json'],
            Tablet: ['responsive.json'],
          },
        },
      },
    });

    expect(issues).toEqual([]);
    const col = collections[0]!;
    expect(col.modeDimension).toBe(1);
    // Segments are aligned to the DECLARED order, not the file order.
    expect(col.modes).toEqual(['modeDesktop', 'modeMobile', 'modeTablet']);
  });

  it('still reports an issue when the declared modes are nowhere to be found', async () => {
    await writeFile(join(dir, 'flat.json'), JSON.stringify({ a: color('#1'), b: color('#2') }));

    const { collections, issues } = await parseOrgManifest(dir, {
      name: 'Design Tokens',
      collections: {
        Flat: { modes: { One: ['flat.json'], Two: ['flat.json'], Three: ['flat.json'] } },
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('mode-count-mismatch');
    expect(issues[0]!.collection).toBe('Flat');
    // Falls back to a single-mode collection so the tokens still load.
    expect(collections[0]!.modes).toBeUndefined();
  });
});

describe('parseOrgManifest: single-mode collections', () => {
  it("keeps the declared mode name as the implicit mode's label", async () => {
    await writeFile(join(dir, 'shape.json'), JSON.stringify({ corner: { sm: color('#1') } }));

    const { collections } = await parseOrgManifest(dir, {
      name: 'Design Tokens',
      collections: { Shape: { modes: { Baseline: ['shape.json'] } } },
    });

    const col = collections[0]!;
    expect(col.modes).toBeUndefined(); // storage stays "no modes declared"
    expect(col.modeLabels).toEqual({ default: 'Baseline' });
  });

  it('round-trips that label instead of renaming it to "Mode 1"', () => {
    const raw = serializeOrgManifest(
      [{ name: 'Shape', files: 'shape.json', modeLabels: { default: 'Baseline' } }],
      'Design Tokens',
    );
    expect(raw['collections']).toEqual({ Shape: { modes: { Baseline: ['shape.json'] } } });

    // No label to keep: the previous default name is used.
    const bare = serializeOrgManifest([{ name: 'Shape', files: 'shape.json' }], 'Design Tokens');
    expect(bare['collections']).toEqual({ Shape: { modes: { 'Mode 1': ['shape.json'] } } });
  });
});
