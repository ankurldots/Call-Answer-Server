import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { silentLogger } from '../src/logger.js';
import { createWsServer, type WsServer } from '../src/server.js';
import { createEchoHandler } from '../src/echo.js';
import { basic, mediaFrame, startFrame, testConfig } from './helpers.js';

let server: WsServer;
let port: number;
const base = () => `http://127.0.0.1:${port}`;

before(async () => {
  server = createWsServer({ config: testConfig({ MAX_CONCURRENT_CALLS: '1', SHUTDOWN_GRACE_SECONDS: '0' }), log: silentLogger, factory: createEchoHandler });
  port = await server.listen();
});
after(async () => { await server.shutdown(); });

async function resolve(sid: string, auth: string | null = basic()) {
  return fetch(`${base()}/exotel/resolve?CallSid=${sid}&CallTo=%2B200&From=%2B100`, { headers: auth ? { Authorization: auth } : {} });
}
const wsUrlFrom = (u: string) => u.replace(/^wss:\/\/localhost/, `ws://127.0.0.1:${port}`);

test('health needs no auth and reveals only counts', async () => {
  const r = await fetch(`${base()}/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'ok', activeCalls: 0 });
});
test('resolve: 401 without credentials, 400 without CallSid, 200 with url', async () => {
  assert.equal((await resolve('CA1', null)).status, 401);
  assert.equal((await resolve('CA1', basic('u', 'bad'))).status, 401);
  assert.equal((await fetch(`${base()}/exotel/resolve`, { headers: { Authorization: basic() } })).status, 400);
  const r = await resolve('CA1');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/);
  const { url } = (await r.json()) as { url: string };
  assert.match(url, /^wss:\/\/localhost\/stream\/[A-Za-z0-9_.-]+\?sample-rate=8000$/);
});
test('resolve accepts POST form body', async () => {
  const r = await fetch(`${base()}/exotel/resolve`, { method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'CallSid=CAP&To=%2B1' });
  assert.equal(r.status, 200);
});
test('handshake refused for bad token and missing basic', async () => {
  const bad = new WebSocket(`ws://127.0.0.1:${port}/stream/not.a.token`, { headers: { Authorization: basic() } });
  const code = await new Promise((r) => bad.on('unexpected-response', (_q, res) => r(res.statusCode)));
  assert.equal(code, 401);
  const { url } = (await (await resolve('CA2')).json()) as { url: string };
  const noAuth = new WebSocket(wsUrlFrom(url));
  assert.equal(await new Promise((r) => noAuth.on('unexpected-response', (_q, res) => r(res.statusCode))), 401);
});

test('full scripted call through a real socket; echo returns audio and mark; token is single use', async () => {
  const { url } = (await (await resolve('CA3')).json()) as { url: string };
  const ws = new WebSocket(wsUrlFrom(url), { headers: { Authorization: basic() } });
  const got: Array<{ event: string; media?: { payload: string }; mark?: { name: string } }> = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  ws.send('{"event":"connected"}');
  ws.send(startFrame('CA3'));
  ws.send(mediaFrame(3200));
  await waitFor(() => got.some((g) => g.event === 'media'));
  const media = got.find((g) => g.event === 'media');
  assert.equal(Buffer.from(media?.media?.payload ?? '', 'base64').length, 3200);
  await waitFor(() => got.some((g) => g.event === 'mark'), 3000);
  assert.equal(server.registry.count(), 1);

  // capacity 1: a second call is refused with 503
  const r2 = (await (await resolve('CA4')).json()) as { url: string };
  const second = new WebSocket(wsUrlFrom(r2.url), { headers: { Authorization: basic() } });
  assert.equal(await new Promise((r) => second.on('unexpected-response', (_q, res) => r(res.statusCode))), 503);

  ws.send('{"event":"stop","stop":{"reason":"callended"}}');
  await new Promise((r) => ws.once('close', r));
  await waitFor(() => server.registry.count() === 0);

  const reuse = new WebSocket(wsUrlFrom(url), { headers: { Authorization: basic() } });
  const closeCode = await new Promise((r) => {
    reuse.on('open', () => reuse.send(startFrame('CA3')));
    reuse.on('close', (c) => r(c));
  });
  assert.equal(closeCode, 1008);
});

async function waitFor(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}
