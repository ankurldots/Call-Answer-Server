import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { checkBasic } from '../src/auth.js';
import { basic, testConfig } from './helpers.js';

const base = { PUBLIC_HOST: 'h.example.com', CALL_TOKEN_SECRET: 's', EXOTEL_BASIC_USER: 'u', EXOTEL_BASIC_PASSWORD: 'p' };

test('defaults', () => {
  const c = loadConfig(base);
  assert.equal(c.port, 8080);
  assert.equal(c.sampleRate, 8000);
  assert.equal(c.echoChunkBytes, 3200);
  assert.equal(c.maxConcurrentCalls, 20);
  assert.equal(c.mediaTimeoutSeconds, 10);
  assert.equal(c.shutdownGraceSeconds, 120);
});
test('reports every invalid value by name without secret values', () => {
  try {
    loadConfig({ AUTH_MODE: 'x', SAMPLE_RATE: '44100', ECHO_CHUNK_BYTES: '3201', CALL_TOKEN_SECRET: 'topsecret' });
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    const msg = e.errors.join('\n');
    for (const n of ['AUTH_MODE', 'SAMPLE_RATE', 'ECHO_CHUNK_BYTES', 'PUBLIC_HOST']) assert.match(msg, new RegExp(n));
    assert.ok(!msg.includes('topsecret'));
  }
});
test('small chunks need ALLOW_SMALL_CHUNKS', () => {
  assert.throws(() => loadConfig({ ...base, ECHO_CHUNK_BYTES: '640' }));
  assert.equal(loadConfig({ ...base, ECHO_CHUNK_BYTES: '640', ALLOW_SMALL_CHUNKS: 'true' }).echoChunkBytes, 640);
  assert.throws(() => loadConfig({ ...base, ECHO_CHUNK_BYTES: '100160' }));
});
test('basic mode requires credentials; none does not', () => {
  assert.throws(() => loadConfig({ PUBLIC_HOST: 'h', CALL_TOKEN_SECRET: 's' }));
  assert.ok(loadConfig({ PUBLIC_HOST: 'h', CALL_TOKEN_SECRET: 's', AUTH_MODE: 'none' }));
});
test('checkBasic', () => {
  assert.ok(checkBasic(basic(), 'u', 'p'));
  assert.ok(!checkBasic(basic('u', 'x'), 'u', 'p'));
  assert.ok(!checkBasic(basic('x', 'p'), 'u', 'p'));
  assert.ok(!checkBasic(undefined, 'u', 'p'));
  assert.ok(!checkBasic('Bearer abc', 'u', 'p'));
  assert.ok(testConfig());
});
