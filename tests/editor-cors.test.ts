import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { type AddressInfo } from 'node:net';
import { editorCors } from '../server/editor-cors.js';

test('Hosted editor access is restricted to the exact configured origin', async () => {
  const origin = 'https://full-video-tool.vercel.app';
  const app = express();
  app.use('/api', editorCors(origin));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(base + '/api/health', { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(response.headers.get('vary') ?? '', /Origin/);
    const preflight = await fetch(base + '/api/health', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PUT/);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    for (const rejected of ['https://other.vercel.app', origin + '.evil.example', 'null']) {
      const denied = await fetch(base + '/api/health', { headers: { Origin: rejected } });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'http://localhost:5173' } })).status, 200);
    assert.equal((await fetch(base + '/api/health')).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Hosted editor origins must be exact HTTPS origins', () => {
  for (const origin of ['*', 'http://example.com', 'https://example.com/path', 'https://example.com/']) assert.throws(() => editorCors(origin));
});
