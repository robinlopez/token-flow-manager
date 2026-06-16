// Build a fully standalone, no-Node distribution of the tool:
//   standalone/tokenflow   — single-file binary (Bun runtime + server + deps)
//   standalone/web/         — the built Angular dashboard, served by the binary
//
// This binary is also the sidecar a Tauri desktop build wraps (see plan.md §10.3).
// Requires Bun on PATH and a prior `@tokenflow/web` build.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(cliRoot, 'standalone');
const web = join(cliRoot, '../web/dist/web/browser');
const binName = process.platform === 'win32' ? 'tokenflow.exe' : 'tokenflow';

if (!existsSync(join(web, 'index.html'))) {
  console.error(`[standalone] SPA build not found at ${web} — run \`pnpm --filter @tokenflow/web build\` first.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log('[standalone] compiling binary with bun…');
execFileSync(
  'bun',
  ['build', '--compile', join(cliRoot, 'src/cli.ts'), '--outfile', join(out, binName)],
  { stdio: 'inherit' },
);

cpSync(web, join(out, 'web'), { recursive: true });
console.log(`[standalone] ready → ${out}/${binName} (+ web/). Run it: ./${binName}`);
