import { createServer } from 'node:net';
import { buildApp, type AppOptions } from './app.js';
import { Session } from './session.js';

export { ProjectManager } from './project.js';
export { buildApp } from './app.js';
export { loadConfig } from './config-loader.js';
export { Session } from './session.js';
export { generateV5Script, detectSdVersion, runTestBuild } from './distribution-v5.js';
export type { DistMatrix, MatrixSource, MatrixTarget, SdVersionInfo } from './distribution-v5.js';

export interface StartOptions {
  /** Project directory to open at launch. Omit to start on the welcome screen. */
  root?: string;
  /** Preferred port; falls back upward if taken. */
  port?: number;
  host?: string;
  webDir?: string;
  authToken?: string;
  logger?: boolean;
  watch?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  session: Session;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 5173;

/** Start the server (optionally opening a project) and listen on an available port. */
export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const session = new Session({ watch: opts.watch });
  if (opts.root) await session.open(opts.root);

  const host = opts.host ?? '127.0.0.1';
  const appOpts: AppOptions = { session };
  if (opts.webDir !== undefined) appOpts.webDir = opts.webDir;
  if (opts.authToken !== undefined) appOpts.authToken = opts.authToken;
  if (opts.logger !== undefined) appOpts.logger = opts.logger;
  const app = await buildApp(appOpts);

  const port = await findOpenPort(opts.port ?? DEFAULT_PORT, host);
  await app.listen({ port, host });

  return {
    url: `http://${host}:${port}`,
    port,
    session,
    close: async () => {
      await app.close();
      await session.close();
    },
  };
}

/** Probe ports starting at `start`, returning the first that is free. */
export async function findOpenPort(start: number, host: string): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + 100}`);
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}
