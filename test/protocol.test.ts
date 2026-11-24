import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { decodeFrame } from '../src/protocol.js';
import { mediaFrame, startFrame } from './helpers.js';

test('decodes start with string numbers and custom parameters', () => {
  const r = decodeFrame(startFrame('CA1', 16000));
  assert.ok(r.ok && r.event.type === 'start');
  if (r.ok && r.event.type === 'start') {
    assert.equal(r.event.format.sampleRate, 16000);
    assert.equal(r.event.callSid, 'CA1');
    assert.deepEqual(r.event.customParameters, { a: 'b' });
  }
});
test('start without custom_parameters is accepted', () => {
  const r = decodeFrame(JSON.stringify({ event: 'start', start: { stream_sid: 's', call_sid: 'c', media_format: { sample_rate: 8000 } } }));
  assert.ok(r.ok);
});
test('decodes connected, media, dtmf, stop, mark', () => {
  assert.ok(decodeFrame('{"event":"connected"}').ok);
  const m = decodeFrame(mediaFrame(320));
  assert.ok(m.ok && m.event.type === 'media' && m.event.payload.length === 320);
  const d = decodeFrame('{"event":"dtmf","dtmf":{"digit":"#","duration":"100"}}');
  assert.ok(d.ok && d.event.type === 'dtmf' && d.event.digit === '#');
  const s = decodeFrame('{"event":"stop","stop":{"reason":"callended"}}');
  assert.ok(s.ok && s.event.type === 'stop' && s.event.reason === 'callended');
  const k = decodeFrame('{"event":"mark","mark":{"name":"x"}}');
  assert.ok(k.ok && k.event.type === 'mark' && k.event.name === 'x');
});
test('odd-length media payload is discarded', () => {
  const r = decodeFrame(mediaFrame(321));
  assert.ok(r.ok && r.event.type === 'media' && r.event.discarded);
});
test('invalid JSON, unknown event and missing fields are errors', () => {
  assert.equal(decodeFrame('nope').ok, false);
  assert.equal(decodeFrame('{"event":"wat"}').ok, false);
  assert.equal(decodeFrame('{"event":"media"}').ok, false);
  assert.equal(decodeFrame('{"event":"start","start":{}}').ok, false);
});
test('decoder never throws', () => {
  fc.assert(fc.property(fc.string(), (s) => { decodeFrame(s); return true; }));
  fc.assert(fc.property(fc.jsonValue(), (v) => { decodeFrame(JSON.stringify(v)); return true; }));
  fc.assert(fc.property(fc.record({ event: fc.constantFrom('start', 'media', 'dtmf', 'stop', 'mark'), start: fc.jsonValue(), media: fc.jsonValue(), dtmf: fc.jsonValue(), mark: fc.jsonValue() }), (v) => { decodeFrame(JSON.stringify(v)); return true; }));
});
