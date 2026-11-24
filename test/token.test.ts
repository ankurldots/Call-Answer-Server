import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { createToken, verifyToken } from '../src/token.js';

const S = 'secret';

test('token round trip', () => {
  const t = createToken(S, 'CA123', 1_000_000);
  assert.deepEqual(verifyToken(S, t, 1_000_000)?.callSid, 'CA123');
});
test('token expires after 60 seconds', () => {
  const t = createToken(S, 'CA1', 0);
  assert.ok(verifyToken(S, t, 60_000));
  assert.equal(verifyToken(S, t, 61_001), null);
});
test('token with wrong secret is rejected', () => {
  assert.equal(verifyToken('other', createToken(S, 'CA1')), null);
});
test('token round trip property', () => {
  fc.assert(fc.property(fc.string({ minLength: 1 }), (sid) => verifyToken(S, createToken(S, sid))?.callSid === sid));
});
test('any modified token is rejected', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 30 }), fc.nat(), fc.string({ minLength: 1, maxLength: 1 }), (sid, pos, ch) => {
      const t = createToken(S, sid);
      const i = pos % t.length;
      if (t[i] === ch) return true;
      return verifyToken(S, t.slice(0, i) + ch + t.slice(i + 1)) === null;
    }),
  );
});
