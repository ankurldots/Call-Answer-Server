import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import type { WebSocket } from 'ws';
import type { CallHandler } from '../src/handler.js';
import { silentLogger } from '../src/logger.js';
import { CallSession } from '../src/session.js';
import { InMemoryTokenUseStore } from '../src/stores.js';
import { mediaFrame, startFrame, testConfig } from './helpers.js';

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  closedWith?: number;
  send(d: string) { this.sent.push(d); }
  close(code?: number) { this.closedWith = code; this.readyState = 3; }
}

function setup(over: Partial<CallHandler> = {}) {
  const ws = new FakeWs();
  const calls = { end: 0, audio: 0, reasons: [] as string[] };
  const handler: CallHandler = {
    onStart() {}, onAudio() { calls.audio++; }, onMark() {}, onDtmf() {},
    end(r) { calls.end++; calls.reasons.push(r); },
    ...over,
  };
  let ended = 0;
  const s = new CallSession(
    ws as unknown as WebSocket,
    { config: testConfig(), log: silentLogger, factory: () => handler, tokenUse: new InMemoryTokenUseStore(), token: 'tok', tokenCallSid: 'CA1', tokenExp: 9e9 },
    () => ended++,
  );
  s.begin();
  return { ws, calls, s, ended: () => ended };
}
const flush = () => new Promise((r) => setImmediate(r));

test('connected, start, media, stop ends exactly once', async () => {
  const { ws, calls, ended } = setup();
  ws.emit('message', Buffer.from('{"event":"connected"}'), false);
  ws.emit('message', Buffer.from(startFrame('CA1')), false);
  ws.emit('message', Buffer.from(mediaFrame(320)), false);
  await flush();
  ws.emit('message', Buffer.from('{"event":"stop","stop":{"reason":"callended"}}'), false);
  ws.emit('close', 1000);
  await flush();
  assert.equal(calls.audio, 1);
  assert.equal(calls.end, 1);
  assert.deepEqual(calls.reasons, ['callended']);
  assert.equal(ended(), 1);
});
test('call_sid mismatch closes with 1008 and creates no handler', async () => {
  const { ws, calls } = setup();
  ws.emit('message', Buffer.from(startFrame('OTHER')), false);
  await flush();
  assert.equal(ws.closedWith, 1008);
  assert.equal(calls.end, 0);
});
test('socket close without stop ends with socket_closed', async () => {
  const { ws, calls } = setup();
  ws.emit('message', Buffer.from(startFrame('CA1')), false);
  ws.emit('close', 1006);
  await flush();
  assert.deepEqual(calls.reasons, ['socket_closed']);
});
test('protocol errors do not end the call', async () => {
  const { ws, calls } = setup();
  ws.emit('message', Buffer.from(startFrame('CA1')), false);
  ws.emit('message', Buffer.from('garbage'), false);
  ws.emit('message', Buffer.from(mediaFrame(320)), false);
  await flush();
  assert.equal(calls.audio, 1);
  assert.equal(calls.end, 0);
});
test('handler error ends the call with handler_error, once', async () => {
  const { ws, calls } = setup({ onAudio() { throw new Error('boom'); } });
  ws.emit('message', Buffer.from(startFrame('CA1')), false);
  ws.emit('message', Buffer.from(mediaFrame(320)), false);
  ws.emit('message', Buffer.from(mediaFrame(320)), false);
  await flush(); await flush();
  assert.deepEqual(calls.reasons, ['handler_error']);
});
test('handler.end throwing still closes the socket', async () => {
  const { ws } = setup({ end() { throw new Error('x'); } });
  ws.emit('message', Buffer.from(startFrame('CA1')), false);
  ws.emit('message', Buffer.from('{"event":"stop"}'), false);
  await flush();
  assert.equal(ws.readyState, 3);
});
test('media timeout ends the call with 1001', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { ws, calls } = setup();
    ws.emit('message', Buffer.from(startFrame('CA1')), false);
    await Promise.resolve();
    mock.timers.tick(10_001);
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls.reasons, ['media_timeout']);
    assert.equal(ws.closedWith, 1001);
  } finally {
    mock.timers.reset();
  }
});
test('no start within 10 seconds closes with 1008', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { ws } = setup();
    mock.timers.tick(10_001);
    await Promise.resolve();
    assert.equal(ws.closedWith, 1008);
  } finally {
    mock.timers.reset();
  }
});
test('token reuse is refused', async () => {
  const tokenUse = new InMemoryTokenUseStore();
  assert.ok(tokenUse.tryUse('tok', 9e9));
  assert.ok(!tokenUse.tryUse('tok', 9e9));
});
