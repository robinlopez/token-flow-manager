// Compile the server into the Tauri sidecar binary, named with the host Rust
// target triple (Tauri's externalBin convention: `tokenflow-<triple>`).
// Runs as tauri's beforeBuildCommand, so `pnpm tauri build` is self-contained.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Host target triple (e.g. aarch64-apple-darwin). rustc is present when building Tauri.
const triple = execFileSync('rustc', ['-vV']).toString().match(/host:\s*(\S+)/)?.[1];
if (!triple) throw new Error('Could not determine the Rust host target triple from `rustc -vV`.');

const ext = triple.includes('windows') ? '.exe' : '';
const out = join(root, 'src-tauri/binaries', `tokenflow-${triple}${ext}`);
mkdirSync(dirname(out), { recursive: true });

console.log(`[tauri-sidecar] compiling ${out}`);
execFileSync(
  'bun',
  ['build', '--compile', join(root, 'packages/cli/src/cli.ts'), '--outfile', out],
  { stdio: 'inherit' },
);
console.log('[tauri-sidecar] done');
