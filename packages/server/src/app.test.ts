import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from './session.js';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

let root: string;
let session: Session;
let app: FastifyInstance;

const SAMPLE =
  JSON.stringify(
    { color: { $type: 'color', primary: { $value: '#ff0000' } } },
    null,
    2,
  ) + '\n';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tfm-http-'));
  await writeFile(join(root, 'app.tokens.json'), SAMPLE);
  session = new Session({ watch: false });
  await session.open(root);
  app = await buildApp({ session });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await session.close();
  await rm(root, { recursive: true, force: true });
});

describe('HTTP API', () => {
  it('GET /api/state returns the project summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/state' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokenCount).toBe(1);
    expect(body.collections[0].name).toBe('Tokens');
  });

  it('GET /api/collections/:name returns tokens', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/collections/Tokens' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens).toHaveLength(1);
  });

  it('PATCH a value persists and returns the updated token', async () => {
    const id = session.current!.getCollection('Tokens')!.tokens[0]!.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tokens/${id}/values/default`,
      payload: { value: '#00ff00' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().token.resolvedValuesByMode.default).toBe('#00ff00');
  });

  it('PATCH with an invalid value returns 422', async () => {
    const id = session.current!.getCollection('Tokens')!.tokens[0]!.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tokens/${id}/values/default`,
      payload: { value: 999 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().ok).toBe(false);
  });

  it('GET an unknown token returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tokens/deadbeef' });
    expect(res.statusCode).toBe(404);
  });
});
