import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import {
  CreateTokenRequestSchema,
  UpdateValueRequestSchema,
  UpdateDescriptionRequestSchema,
  RenameTokenRequestSchema,
  ApplyQuickFixRequestSchema,
  SearchFiltersSchema,
  UpdateConfigRequestSchema,
  ReorderRequestSchema,
  MoveTokensRequestSchema,
  AddModeRequestSchema,
  RenameModeRequestSchema,
  DeleteModeRequestSchema,
  DuplicateModeRequestSchema,
  AddCollectionRequestSchema,
  RenameCollectionRequestSchema,
  DeleteCollectionRequestSchema,
  MoveGroupRequestSchema,
  RenameGroupRequestSchema,
  DeleteGroupRequestSchema,
  DuplicateGroupRequestSchema,
  UndoRedoRequestSchema,
  UpdateValuesBatchRequestSchema,
  CopyTokenToRequestSchema,
  OpenProjectRequestSchema,
  UpdateManifestRequestSchema,
  InitManifestRequestSchema,
  TestBuildRequestSchema,
  WriteDistributionRequestSchema,
  ResolverTestBuildRequestSchema,
  ResolverWriteRequestSchema,
  LinkConfigRequestSchema,
  RunCommandRequestSchema,
  type RealtimeEvent,
} from '@tokenflow/shared';
import type { ProjectManager } from './project.js';
import type { Session } from './session.js';

export interface AppOptions {
  session: Session;
  /** Directory containing the built Angular dashboard, if available. */
  webDir?: string;
  /** Shared secret required as `?token=` on every request (local auth). */
  authToken?: string;
  logger?: boolean;
}

/** /api paths that work with no project open (welcome screen). */
const NO_PROJECT_ROUTES = new Set([
  '/api/state',
  '/api/open',
  '/api/close',
  '/api/browse',
  '/api/recents',
  '/api/recents/remove',
  '/api/pick-folder',
]);

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { session } = opts;
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(fastifyWebsocket);

  // CORS: the desktop (Tauri) webview runs at `tauri://localhost` and calls this
  // server cross-origin. The server is localhost-only and token-gated, so we
  // reflect the origin and answer preflights (before auth, so OPTIONS passes).
  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', req.headers.origin ?? '*');
    reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    reply.header('access-control-allow-headers', 'content-type, x-tokenflow-token');
    if (req.method === 'OPTIONS') reply.code(204).send();
  });

  // Local auth: a random token is handed to the browser at launch.
  if (opts.authToken) {
    app.addHook('onRequest', async (req, reply) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      // Allow static assets and the WS upgrade to pass through with the token.
      const token = url.searchParams.get('token') ?? req.headers['x-tokenflow-token'];
      if (url.pathname.startsWith('/api') && token !== opts.authToken) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
  }

  // Routes that touch the project return 409 until one is opened.
  app.addHook('onRequest', async (req, reply) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path.startsWith('/api') && !NO_PROJECT_ROUTES.has(path) && !session.current) {
      reply.code(409).send({ error: 'No project open' });
    }
  });

  registerSessionRoutes(app, session);

  // Routes below assume an open project; the guard above enforces it. The proxy
  // forwards to whichever project is currently open, so route bodies stay simple.
  const projectProxy = new Proxy({} as ProjectManager, {
    get(_t, prop: string) {
      const cur = session.current;
      if (!cur) throw new Error('No project open');
      const value = (cur as unknown as Record<string, unknown>)[prop];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(cur) : value;
    },
  });
  registerApiRoutes(app, projectProxy, opts.authToken);
  registerRealtime(app, session);

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      reply.sendFile('index.html'); // SPA fallback
    });
  }

  return app;
}

/** Routes that work with no project open: state, the folder browser and open/recents. */
function registerSessionRoutes(app: FastifyInstance, session: Session): void {
  app.get('/api/state', async () => session.getState());
  app.get('/api/recents', async () => ({ recents: session.getRecents() }));

  app.post<{ Body: unknown }>('/api/recents/remove', async (req, reply) => {
    const parsed = OpenProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { recents: session.removeRecent(parsed.data.path) };
  });

  app.post('/api/pick-folder', async () => ({ path: await session.pickFolder() }));

  app.get<{ Querystring: { path?: string } }>('/api/browse', async (req, reply) => {
    try {
      return session.browse(req.query.path);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: unknown }>('/api/open', async (req, reply) => {
    const parsed = OpenProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await session.open(parsed.data.path);
      return session.getState();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/close', async () => {
    await session.close();
    return session.getState();
  });
}

function registerApiRoutes(
  app: FastifyInstance,
  project: ProjectManager,
  _authToken?: string,
): void {
  app.get('/api/diagnostics', async () => ({ diagnostics: project.getDiagnostics() }));

  app.get('/api/config', async () => project.getConfig());

  app.post('/api/reload', async () => {
    await project.reload();
    return project.getState();
  });

  app.patch<{ Body: unknown }>('/api/config', async (req, reply) => {
    const parsed = UpdateConfigRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const config = await project.updateSettings(parsed.data);
    return { config };
  });

  app.get<{ Params: { name: string } }>('/api/collections/:name', async (req, reply) => {
    const collection = project.getCollection(req.params.name);
    if (!collection) return reply.code(404).send({ error: 'Collection not found' });
    return collection;
  });

  app.get('/api/tokens', async () => ({ tokens: project.getAllTokens() }));

  app.get<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
    const token = project.getToken(req.params.id);
    if (!token) return reply.code(404).send({ error: 'Token not found' });
    return { token };
  });

  app.patch<{ Params: { id: string; mode: string }; Body: unknown }>(
    '/api/tokens/:id/values/:mode',
    async (req, reply) => {
      const parsed = UpdateValueRequestSchema.safeParse({
        mode: req.params.mode,
        value: (req.body as { value?: unknown })?.value,
      });
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const result = await project.updateValue(req.params.id, req.params.mode, parsed.data.value);
      return reply.code(result.ok ? 200 : 422).send(result);
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/tokens/:id/description',
    async (req, reply) => {
      const parsed = UpdateDescriptionRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const result = await project.updateDescription(req.params.id, parsed.data.description);
      return reply.code(result.ok ? 200 : 422).send(result);
    },
  );

  app.patch<{ Body: unknown }>('/api/tokens/batch', async (req, reply) => {
    const parsed = UpdateValuesBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.updateValuesBatch(parsed.data.changes);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/tokens', async (req, reply) => {
    const parsed = CreateTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.createToken(parsed.data);
    return reply.code(result.ok ? 201 : 422).send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
    const result = await project.deleteToken(req.params.id);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.get<{ Params: { id: string } }>('/api/tokens/:id/references', async (req) => {
    return { references: project.getReferences(req.params.id) };
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/tokens/:id/rename-preview',
    async (req, reply) => {
      const path = (req.query.path ?? '').split('.').filter(Boolean);
      if (path.length === 0) return reply.code(400).send({ error: 'path query required' });
      return project.renamePreview(req.params.id, path);
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/tokens/:id/rename',
    async (req, reply) => {
      const parsed = RenameTokenRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const result = await project.renameToken(
        req.params.id,
        parsed.data.newPath,
        parsed.data.updateReferences,
      );
      return reply.code(result.ok ? 200 : 422).send(result);
    },
  );

  app.get<{ Querystring: Record<string, string> }>('/api/search', async (req, reply) => {
    const q = req.query['q'] ?? '';
    const typesParam = req.query['types'];
    const aliasParam = req.query['alias'];
    const rawFilters = {
      types: typesParam ? typesParam.split(',').filter(Boolean) : undefined,
      collection: req.query['collection'],
      alias: aliasParam === 'only' || aliasParam === 'none' ? aliasParam : undefined,
      deprecated: req.query['deprecated'] === 'true' ? true : undefined,
      orphans: req.query['orphans'] === 'true' ? true : undefined,
      hasErrors: req.query['hasErrors'] === 'true' ? true : undefined,
    };
    const parsed = SearchFiltersSchema.safeParse(rawFilters);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return project.search(q, parsed.data);
  });

  app.post<{ Body: unknown }>('/api/tokens/reorder', async (req, reply) => {
    const parsed = ReorderRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.reorderTokens(
      parsed.data.collection,
      parsed.data.groupPath,
      parsed.data.order,
    );
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/tokens/move', async (req, reply) => {
    const parsed = MoveTokensRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.moveTokensBatch(parsed.data.moves);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/modes/add', async (req, reply) => {
    const parsed = AddModeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.addMode(parsed.data.collection, parsed.data.name, parsed.data.fromMode);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/modes/rename', async (req, reply) => {
    const parsed = RenameModeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.renameMode(parsed.data.collection, parsed.data.from, parsed.data.to);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/modes/delete', async (req, reply) => {
    const parsed = DeleteModeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.deleteMode(parsed.data.collection, parsed.data.mode);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/modes/duplicate', async (req, reply) => {
    const parsed = DuplicateModeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.duplicateMode(parsed.data.collection, parsed.data.mode);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post('/api/manifest/generate', async (_req, reply) => {
    const result = await project.generateOrgManifest();
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post('/api/manifest/open', async (_req, reply) => {
    const abs = join(project.root, 'manifest.json');
    if (!existsSync(abs)) return reply.code(404).send({ ok: false });
    const ok = await project.openInEditor(abs);
    return reply.send({ ok });
  });

  app.post<{ Body: unknown }>('/api/collections/add', async (req, reply) => {
    const parsed = AddCollectionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.addCollection(parsed.data.name);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/collections/rename', async (req, reply) => {
    const parsed = RenameCollectionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.renameCollection(parsed.data.from, parsed.data.to);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/collections/delete', async (req, reply) => {
    const parsed = DeleteCollectionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.deleteCollection(parsed.data.name);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/groups/move', async (req, reply) => {
    const parsed = MoveGroupRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.moveGroup(
      parsed.data.collection,
      parsed.data.groupPath,
      parsed.data.newParentPath,
    );
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/groups/rename', async (req, reply) => {
    const parsed = RenameGroupRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.renameGroup(
      parsed.data.collection,
      parsed.data.groupPath,
      parsed.data.newName,
    );
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/groups/delete', async (req, reply) => {
    const parsed = DeleteGroupRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.deleteGroup(parsed.data.collection, parsed.data.groupPath);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Body: unknown }>('/api/groups/duplicate', async (req, reply) => {
    const parsed = DuplicateGroupRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.duplicateGroup(parsed.data.collection, parsed.data.groupPath);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Params: { id: string } }>('/api/tokens/:id/duplicate', async (req, reply) => {
    const result = await project.duplicateToken(req.params.id);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/tokens/:id/copy-to', async (req, reply) => {
    const parsed = CopyTokenToRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.copyTokenTo(req.params.id, parsed.data.targetParentPath);
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  app.get('/api/history', async () => project.getHistoryState());

  app.post<{ Body: unknown }>('/api/undo', async (req, reply) => {
    const parsed = UndoRedoRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.undo(parsed.data.force);
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  app.post<{ Body: unknown }>('/api/redo', async (req, reply) => {
    const parsed = UndoRedoRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.redo(parsed.data.force);
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  app.post<{ Body: unknown }>('/api/quick-fix', async (req, reply) => {
    const parsed = ApplyQuickFixRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await project.applyQuickFix(
      parsed.data.tokenId,
      parsed.data.action,
      parsed.data.mode,
      parsed.data.data,
    );
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  // ---- Distribution (Phase 4 — token-config.json companion) ----

  app.get('/api/distribution', async () => project.getDistribution());

  app.put<{ Body: unknown }>('/api/distribution', async (req, reply) => {
    const parsed = UpdateManifestRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.updateManifest(parsed.data.manifest);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: unknown }>('/api/distribution/init', async (req, reply) => {
    const parsed = InitManifestRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.initDistribution(parsed.data.scaffoldScript);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/distribution/scaffold-script', async (_req, reply) => {
    try {
      return await project.scaffoldBuildScript();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: unknown }>('/api/distribution/test-build', async (req, reply) => {
    const parsed = TestBuildRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.testBuildDistribution(parsed.data.matrix);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: unknown }>('/api/distribution/write', async (req, reply) => {
    const parsed = WriteDistributionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.writeDistribution(parsed.data.matrix, parsed.data.cleanPrevious ?? false);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Deterministic resolver (collection-centric config) — the path the redesigned
  // wizard drives. Dry-run is sandboxed; write embeds the config + adds an npm script.

  app.post<{ Body: unknown }>('/api/distribution/resolver/test-build', async (req, reply) => {
    const parsed = ResolverTestBuildRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.testBuildResolver(parsed.data.config);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: unknown }>('/api/distribution/resolver/write', async (req, reply) => {
    const parsed = ResolverWriteRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.writeResolver(parsed.data.config, parsed.data.cleanPrevious ?? false);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // "I have my own config" — link / unlink an external build, and run it (real).

  app.post<{ Body: unknown }>('/api/distribution/link', async (req, reply) => {
    const parsed = LinkConfigRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const { cleanPrevious, ...link } = parsed.data;
      return await project.linkExisting(link, cleanPrevious ?? false);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: { path?: unknown } }>('/api/distribution/open', async (req, reply) => {
    const rel = req.body?.path;
    if (typeof rel !== 'string' || !rel) return reply.code(400).send({ ok: false });
    // Confine to the project root (no escaping via `..`).
    const abs = resolve(project.root, rel);
    if (abs !== project.root && !abs.startsWith(project.root + '/')) return reply.code(400).send({ ok: false });
    if (!existsSync(abs)) return reply.code(404).send({ ok: false });
    return reply.send({ ok: await project.openInEditor(abs) });
  });

  app.post('/api/distribution/unlink', async (_req, reply) => {
    try {
      return await project.unlinkExisting();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: unknown }>('/api/distribution/run-command', async (req, reply) => {
    const parsed = RunCommandRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await project.runProjectCommand(parsed.data.buildCommand);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

function registerRealtime(app: FastifyInstance, session: Session): void {
  const sockets = new Set<{ send: (data: string) => void }>();

  const onEvent = (event: RealtimeEvent) => {
    const payload = JSON.stringify(event);
    for (const s of sockets) {
      try {
        s.send(payload);
      } catch {
        /* drop */
      }
    }
  };
  session.on('event', onEvent);

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'project-reloaded' } satisfies RealtimeEvent));
    socket.on('close', () => sockets.delete(socket));
  });

  app.addHook('onClose', async () => {
    session.off('event', onEvent);
  });
}
