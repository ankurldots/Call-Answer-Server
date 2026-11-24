import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { chunkPcm, tone } from '../src/chunker.js';

test('chunks are exact multiples and concatenation equals input plus silence', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 20000 }), fc.integer({ min: 10, max: 60 }), (arr, k) => {
      const size = k * 320;
      const pcm = Buffer.from(arr);
      const chunks = chunkPcm(pcm, size);
      assert.ok(chunks.every((c) => c.length === size && c.length % 320 === 0));
      const joined = Buffer.concat(chunks);
      assert.deepEqual(joined.subarray(0, pcm.length), pcm);
      assert.ok(joined.subarray(pcm.length).every((b) => b === 0));
      assert.ok(joined.length - pcm.length < size);
    }),
  );
});
test('rejects bad chunk size', () => {
  assert.throws(() => chunkPcm(Buffer.alloc(10), 100));
});
test('tone is 1 second of 16-bit samples', () => {
  assert.equal(tone(8000, 1000).length, 16000);
});
