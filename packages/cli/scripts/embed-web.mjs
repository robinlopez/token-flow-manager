// Copy the built Angular dashboard next to the CLI bundle (dist/web) so the
// published package serves the UI without the monorepo layout. Run after tsup.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(cliRoot, '../web/dist/web/browser');
const dest = join(cliRoot, 'dist/web');

if (!existsSync(join(src, 'index.html'))) {
  console.warn(`[embed-web] SPA build not found at ${src} — build @tokenflow/web first. Skipping.`);
  process.exit(0);
}
cpSync(src, dest, { recursive: true });
console.log(`[embed-web] Copied dashboard → ${dest}`);
