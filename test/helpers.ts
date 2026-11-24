import { loadConfig, type Config } from '../src/config.js';

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    PORT: '0',
    PUBLIC_HOST: 'localhost',
    AUTH_MODE: 'basic',
    EXOTEL_BASIC_USER: 'u',
    EXOTEL_BASIC_PASSWORD: 'p',
    CALL_TOKEN_SECRET: 'secret',
    ...over,
  });
}

export const basic = (u = 'u', p = 'p') => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

export const startFrame = (callSid: string, rate = 8000) =>
  JSON.stringify({
    event: 'start',
    sequence_number: '1',
    stream_sid: 'st1',
    start: {
      stream_sid: 'st1',
      call_sid: callSid,
      account_sid: 'acc',
      from: '+100',
      to: '+200',
      custom_parameters: { a: 'b' },
      media_format: { encoding: 'base64', sample_rate: String(rate), bit_rate: '128kbps' },
    },
  });

export const mediaFrame = (bytes: number) =>
  JSON.stringify({ event: 'media', stream_sid: 'st1', media: { chunk: '1', timestamp: '10', payload: Buffer.alloc(bytes, 1).toString('base64') } });
