import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Pacer } from '../src/pacer.js';

test('paces chunks in real time, pads before mark, clear drops queue', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const events: string[] = [];
  const p = new Pacer(3200, 8000, { media: (c) => events.push(`m${c.length}`), mark: (n) => events.push(`k:${n}`) }, () => now);
  try {
    p.sendAudio(Buffer.alloc(3200 * 2 + 100));
    assert.deepEqual(events, ['m3200']);
    now = 200;
    mock.timers.tick(200);
    assert.deepEqual(events, ['m3200', 'm3200']);
    p.sendMark('a');
    assert.deepEqual(events, ['m3200', 'm3200']);
    now = 400;
    mock.timers.tick(200);
    assert.deepEqual(events, ['m3200', 'm3200', 'm3200', 'k:a']);
    p.sendAudio(Buffer.alloc(9600));
    now = 400;
    assert.equal(p.clear(), 9600);
    mock.timers.tick(1000);
    assert.equal(events.length, 4);
  } finally {
    p.stop();
    mock.timers.reset();
  }
});
