import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScaffoldTemplateRequestSchema } from '@tokenflow/shared';
import { loadConfig } from './config-loader.js';
import { ProjectManager } from './project.js';
import { listTemplates, getTemplate, scaffoldTemplate } from './templates/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tf-templates-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('template catalog', () => {
  it('exposes the four starters with counts derived from their payloads', () => {
    const templates = listTemplates();
    expect(templates.map((t) => t.id)).toEqual([
      'tailwind-v4',
      'material-design-3',
      'semantic-functional-ds',
      'simple-design-system-figma',
    ]);
    for (const t of templates) {
      expect(t.collections.length).toBeGreaterThan(0);
      expect(t.tokenCount).toBeGreaterThan(0);
      expect(t.fileCount).toBeGreaterThan(1); // token files + manifest.json
      expect(t.bytes).toBeGreaterThan(0);
      // The advertised total is the sum of the per-collection counts.
      expect(t.collections.reduce((n, c) => n + c.tokenCount, 0)).toBe(t.tokenCount);
    }
  });

  it('advertises the multi-mode collections users pick these templates for', () => {
    const md3 = getTemplate('material-design-3')!;
    expect(md3.collections.find((c) => c.name === 'M3')!.modes).toHaveLength(32);
    expect(md3.hasStyles).toBe(true);

    const sem = getTemplate('semantic-functional-ds')!;
    expect(sem.collections.find((c) => c.name === 'Primitives')!.modes).toEqual([
      'Brand 1',
      'Brand 2',
      'Brand 3',
    ]);
    expect(sem.collections.find((c) => c.name === 'Semantics')!.modes).toEqual(['Light', 'Dark']);

    expect(getTemplate('nope')).toBeNull();
  });
});

describe('scaffoldTemplate', () => {
  it('writes the template into a new folder under the picked parent', async () => {
    const res = await scaffoldTemplate({
      templateId: 'tailwind-v4',
      parent: dir,
      folder: 'design-tokens',
      overwrite: false,
    });
    expect(res.ok).toBe(true);
    expect(res.path).toBe(join(dir, 'design-tokens'));
    expect(res.files).toContain('manifest.json');
    expect(res.files).toContain('tailwindcss-colors.json');
    // Inflated bytes must be valid JSON identical to the embedded source.
    const manifest = JSON.parse(await readFile(join(res.path, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.collections)).toEqual(['TailwindCSS_Metrics', 'TailwindCSS_Colors']);
  });

  it('writes straight into the picked folder when no name is given', async () => {
    const res = await scaffoldTemplate({ templateId: 'tailwind-v4', parent: dir, overwrite: false });
    expect(res.ok).toBe(true);
    expect(res.path).toBe(dir);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
  });

  it('refuses to clobber existing files, and reports which ones', async () => {
    await mkdir(join(dir, 'design-tokens'), { recursive: true });
    await writeFile(join(dir, 'design-tokens/manifest.json'), '{"mine":true}');

    const res = await scaffoldTemplate({
      templateId: 'tailwind-v4',
      parent: dir,
      folder: 'design-tokens',
      overwrite: false,
    });
    expect(res.ok).toBe(false);
    expect(res.conflicts).toEqual(['manifest.json']);
    // Nothing was written: the pre-existing file is untouched and no siblings appeared.
    expect(await readFile(join(dir, 'design-tokens/manifest.json'), 'utf8')).toBe('{"mine":true}');
    expect(existsSync(join(dir, 'design-tokens/tailwindcss-colors.json'))).toBe(false);

    const forced = await scaffoldTemplate({
      templateId: 'tailwind-v4',
      parent: dir,
      folder: 'design-tokens',
      overwrite: true,
    });
    expect(forced.ok).toBe(true);
    expect(existsSync(join(dir, 'design-tokens/tailwindcss-colors.json'))).toBe(true);
  });

  it('rejects an unknown template and a parent that is not a directory', async () => {
    const unknown = await scaffoldTemplate({ templateId: 'nope', parent: dir, overwrite: false });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/Unknown template/);

    const missing = await scaffoldTemplate({
      templateId: 'tailwind-v4',
      parent: join(dir, 'does-not-exist'),
      overwrite: false,
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/Not a directory/);
  });

  // Plain-object indexing walks the prototype chain, so these ids used to come
  // back truthy and slip past the "unknown template" guard.
  it('treats prototype keys as unknown templates, not as payloads', async () => {
    for (const templateId of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const res = await scaffoldTemplate({ templateId, parent: dir, overwrite: false });
      expect(res.ok).toBe(false);
      expect(res.error).toBe(`Unknown template: ${templateId}`);
    }
    // Nothing was created while probing.
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false);
  });

  it('never follows a symlink at a destination file name, even with overwrite', async () => {
    const outside = join(dir, 'outside.json');
    await writeFile(outside, '{"precious":true}');
    await mkdir(join(dir, 'design-tokens'), { recursive: true });
    await symlink(outside, join(dir, 'design-tokens/manifest.json'));

    for (const overwrite of [false, true]) {
      const res = await scaffoldTemplate({
        templateId: 'tailwind-v4',
        parent: dir,
        folder: 'design-tokens',
        overwrite,
      });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/symlink/);
      expect(res.conflicts).toContain('manifest.json');
    }
    // The symlink target is untouched and no sibling was written.
    expect(await readFile(outside, 'utf8')).toBe('{"precious":true}');
    expect(existsSync(join(dir, 'design-tokens/tailwindcss-colors.json'))).toBe(false);
  });
});

describe('ScaffoldTemplateRequestSchema: folder name', () => {
  const parse = (folder: string) =>
    ScaffoldTemplateRequestSchema.safeParse({ templateId: 'tailwind-v4', parent: '/tmp', folder });

  it('rejects anything that could redirect the write', () => {
    const rejected = [
      '..',
      '.',
      '.hidden',
      '../escape',
      'a/b',
      'a\\b',
      '/absolute',
      ' padded',
      'trailing ',
      '',
      // Control characters, written as escapes so no literal control byte lands
      // in this source file.
      'nul\u0000byte',
      'bell\u0007',
      'del\u007f',
    ];
    for (const folder of rejected) {
      expect(parse(folder).success, `expected ${JSON.stringify(folder)} to be rejected`).toBe(false);
    }
  });

  it('accepts ordinary folder names', () => {
    for (const folder of ['design-tokens', 'tokens_v2', 'Design Tokens', 'ds2', 'a'.repeat(120)]) {
      expect(parse(folder).success, `expected ${JSON.stringify(folder)} to be accepted`).toBe(true);
    }
    expect(parse('a'.repeat(121)).success).toBe(false);
  });
});

describe('a scaffolded template opens as a well-formed project', () => {
  // The payoff of shipping `manifest.json` with each template: organization comes
  // from the manifest (not auto-detection), so collections, modes and mode column
  // counts land exactly as the card advertised, with resolvable aliases.
  for (const template of listTemplates()) {
    it(`${template.id}: manifest-driven collections, modes and no broken aliases`, async () => {
      const res = await scaffoldTemplate({ templateId: template.id, parent: dir, overwrite: false });
      expect(res.ok).toBe(true);

      const { config, organizationSource, manifestIssues } = await loadConfig(res.path);
      expect(organizationSource).toBe('manifest');
      expect(manifestIssues).toEqual([]);

      const project = new ProjectManager(res.path, config);
      await project.load();
      try {
        const state = project.getState();
        expect(state.collections.map((c) => c.name)).toEqual(template.collections.map((c) => c.name));
        for (const advertised of template.collections) {
          const actual = state.collections.find((c) => c.name === advertised.name)!;
          // Manifest mode names ride along as display labels over the physical ids.
          expect(actual.modes.map((m) => m.label ?? m.id)).toEqual(advertised.modes);
          expect(actual.tokenCount).toBe(advertised.tokenCount);
        }
        expect(state.tokenCount).toBe(template.tokenCount);

        const broken = project.getDiagnostics().filter((d) => d.code === 'broken-alias');
        expect(broken).toEqual([]);
      } finally {
        await project.dispose();
      }
    });
  }
});
