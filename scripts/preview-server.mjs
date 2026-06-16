// Dev/preview launcher: starts the server with NO auth token so the browser
// preview can hit `/` directly. Not for production use.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../packages/server/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2] ?? process.env.TFM_ROOT;
// Pass "--welcome" (or no path) to start with no project → welcome screen.
const root = arg && arg !== '--welcome' ? arg : undefined;
const port = Number(process.env.PORT ?? 5300);
const webDir = join(__dirname, '../packages/web/dist/web/browser');

const server = await startServer({ ...(root ? { root } : {}), port, webDir, watch: true });
console.log(`Preview server: ${server.url}${root ? ` (root: ${root})` : ' (welcome screen)'}`);
