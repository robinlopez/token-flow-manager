import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  target: 'node20',
  // Inline the workspace packages so the published CLI is self-contained; keep
  // third-party deps external (they ship as `dependencies` and `npm i` installs them).
  noExternal: [/^@tokenflow\//],
});
