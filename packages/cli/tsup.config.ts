import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Single source of truth for `--version`. A hardcoded literal in cli.ts had
// drifted (it still said 0.1.4 at 0.1.6), so the version is inlined from the
// package manifest at build time instead.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  define: { __CLI_VERSION__: JSON.stringify(version) },
  format: ['esm'],
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  target: 'node20',
  // Inline the workspace packages so the published CLI is self-contained; keep
  // third-party deps external (they ship as `dependencies` and `npm i` installs them).
  noExternal: [/^@tokenflow\//],
});
