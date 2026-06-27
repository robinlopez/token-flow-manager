import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';
import open from 'open';
import { startServer, loadConfig, ProjectManager } from '@tokenflow/server';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Locate the built Angular dashboard relative to the installed CLI, if present. */
function resolveWebDir(): string | undefined {
  // In a compiled single-file binary (bun --compile), import.meta.url is virtual,
  // so also resolve relative to the real executable — lets a standalone binary
  // serve a sibling `web/` folder.
  const execDir = dirname(process.execPath);
  const candidates = [
    join(__dirname, 'web'), // embedded next to dist/cli.js in the published package
    join(__dirname, '../web'),
    join(execDir, 'web'), // sibling of a standalone binary
    join(execDir, '../Resources/web'), // inside a macOS .app bundle
    join(__dirname, '../../web/dist/web/browser'), // monorepo dev layout
    join(__dirname, '../../web/dist/web'),
  ];
  return candidates.find((c) => existsSync(join(c, 'index.html')));
}

const program = new Command();

program
  .name('token-flow-manager')
  .description('Local Design Tokens manager — DTCG 2025.10')
  .version('0.1.2');

program
  .argument('[path]', 'project directory to open (omit to pick one from the welcome screen)')
  .option('-p, --port <port>', 'preferred port', (v) => parseInt(v, 10))
  .option('--host <host>', 'host to bind', '127.0.0.1')
  .option('--token <token>', 'auth token (auto-generated if omitted; used by the desktop shell)')
  .option('--no-open', 'do not open the browser automatically')
  .option('--no-watch', 'do not watch files for external changes')
  .action(async (path: string | undefined, opts: CliOptions) => {
    await runServer(path, opts);
  });

program
  .command('validate [path]')
  .description('Parse and resolve all tokens, print diagnostics, exit non-zero on errors')
  .action(async (path = '.') => {
    await runValidate(path);
  });

program
  .command('init [path]')
  .description('Create a starter tokenflow.config.json')
  .action((path = '.') => {
    runInit(path);
  });

interface CliOptions {
  port?: number;
  host: string;
  token?: string;
  open: boolean;
  watch: boolean;
}

async function runServer(path: string | undefined, opts: CliOptions): Promise<void> {
  // No path → start on the welcome screen (pick a project in the browser).
  const root = path ? resolve(process.cwd(), path) : undefined;
  if (root && !existsSync(root)) {
    console.error(pc.red(`Path does not exist: ${root}`));
    process.exit(1);
  }

  const authToken = opts.token ?? randomBytes(16).toString('hex');
  const webDir = resolveWebDir();

  console.log(pc.bold(pc.cyan('\n  Token Flow Manager')));
  console.log(pc.dim(`  ${root ?? 'no project — open one from the welcome screen'}\n`));

  const startOpts = {
    host: opts.host,
    authToken,
    watch: opts.watch,
    ...(root !== undefined ? { root } : {}),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(webDir !== undefined ? { webDir } : {}),
  };
  const server = await startServer(startOpts);

  const state = server.session.getState();
  const errors = state.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = state.diagnostics.filter((d) => d.severity === 'warning').length;

  const url = `${server.url}/?token=${authToken}`;
  console.log(`  ${pc.green('➜')}  Dashboard: ${pc.cyan(url)}`);
  if (state.open) {
    console.log(
      `  ${pc.dim('•')}  ${state.tokenCount} tokens · ${state.collections.length} collections · ` +
        `${errors} ${pc.red('errors')} · ${warnings} ${pc.yellow('warnings')}`,
    );
  } else {
    console.log(`  ${pc.dim('•')}  Open a project from the welcome screen.`);
  }
  if (!webDir) {
    console.log(pc.yellow('\n  Dashboard build not found — API is running, UI not bundled yet.'));
  }
  console.log(pc.dim('\n  Press Ctrl+C to stop.\n'));

  if (opts.open && webDir) {
    await open(url).catch(() => {});
  }

  const shutdown = async () => {
    console.log(pc.dim('\n  Shutting down…'));
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runValidate(path: string): Promise<void> {
  const root = resolve(process.cwd(), path);
  const { config } = await loadConfig(root);
  const project = new ProjectManager(root, config);
  await project.load();
  const diags = project.getDiagnostics();
  const errors = diags.filter((d) => d.severity === 'error');
  const warnings = diags.filter((d) => d.severity === 'warning');

  for (const d of diags) {
    const tag =
      d.severity === 'error' ? pc.red('error') : d.severity === 'warning' ? pc.yellow('warn') : pc.blue('info');
    const loc = d.file ? pc.dim(` ${d.file}${d.line != null ? `:${d.line + 1}` : ''}`) : '';
    console.log(`  ${tag} ${pc.dim(`[${d.code}]`)} ${d.message}${loc}`);
  }
  console.log(
    `\n  ${project.getState().tokenCount} tokens · ${errors.length} errors · ${warnings.length} warnings`,
  );
  await project.dispose();
  process.exit(errors.length > 0 ? 1 : 0);
}

function runInit(path: string): void {
  const root = resolve(process.cwd(), path);
  const file = join(root, 'tokenflow.config.json');
  if (existsSync(file)) {
    console.log(pc.yellow(`  tokenflow.config.json already exists at ${root}`));
    return;
  }
  mkdirSync(root, { recursive: true });
  const starter = {
    collections: [
      { name: 'Tokens', files: 'tokens/**/*.tokens.json', modes: ['light', 'dark'] },
    ],
    resolution: { crossCollection: true, order: ['Tokens'], maxAliasDepth: 10 },
    writeDebounceMs: 200,
  };
  writeFileSync(file, JSON.stringify(starter, null, 2) + '\n');
  console.log(pc.green(`  Created ${file}`));
}

program.parseAsync(process.argv);
