import type { Level } from './logger.js';

export type SampleRate = 8000 | 16000 | 24000;

export interface Config {
  port: number;
  publicHost: string;
  authMode: 'basic' | 'none';
  basicUser: string;
  basicPassword: string;
  tokenSecret: string;
  sampleRate: SampleRate;
  handler: string;
  echoChunkBytes: number;
  allowSmallChunks: boolean;
  mediaTimeoutSeconds: number;
  frameLogDir: string | undefined;
  recordRawAudio: boolean;
  logLevel: Level;
  maxConcurrentCalls: number;
  shutdownGraceSeconds: number;
}

export class ConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
  }
}

export const MIN_CHUNK = 3200;
export const MAX_CHUNK = 100000;
export const SAMPLE_MULTIPLE = 320;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const errors: string[] = [];
  const str = (k: string): string | undefined => {
    const v = env[k]?.trim();
    return v ? v : undefined;
  };
  const int = (k: string, def: number, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    const raw = str(k);
    if (raw === undefined) return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${k} must be an integer between ${min} and ${max}`);
      return def;
    }
    return n;
  };
  const bool = (k: string, def: boolean): boolean => {
    const raw = str(k)?.toLowerCase();
    if (raw === undefined) return def;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    errors.push(`${k} must be true or false`);
    return def;
  };

  const authModeRaw = str('AUTH_MODE') ?? 'basic';
  if (authModeRaw !== 'basic' && authModeRaw !== 'none') errors.push('AUTH_MODE must be basic or none');
  const authMode = authModeRaw === 'none' ? 'none' : 'basic';

  const basicUser = str('EXOTEL_BASIC_USER') ?? '';
  const basicPassword = str('EXOTEL_BASIC_PASSWORD') ?? '';
  if (authMode === 'basic') {
    if (!basicUser) errors.push('EXOTEL_BASIC_USER is required when AUTH_MODE is basic');
    if (!basicPassword) errors.push('EXOTEL_BASIC_PASSWORD is required when AUTH_MODE is basic');
  }

  const tokenSecret = str('CALL_TOKEN_SECRET') ?? '';
  if (!tokenSecret) errors.push('CALL_TOKEN_SECRET is required');

  const publicHost = str('PUBLIC_HOST') ?? '';
  if (!publicHost) errors.push('PUBLIC_HOST is required');
  else if (/[/\s]|^[a-z]+:/i.test(publicHost.replace(/:\d+$/, ''))) {
    errors.push('PUBLIC_HOST must be a host name (optionally with port), without scheme or path');
  }

  const rate = int('SAMPLE_RATE', 8000, 1);
  if (![8000, 16000, 24000].includes(rate)) errors.push('SAMPLE_RATE must be 8000, 16000 or 24000');

  const allowSmallChunks = bool('ALLOW_SMALL_CHUNKS', false);
  const echoChunkBytes = int('ECHO_CHUNK_BYTES', MIN_CHUNK, 1, MAX_CHUNK);
  const minChunk = allowSmallChunks ? SAMPLE_MULTIPLE : MIN_CHUNK;
  if (echoChunkBytes % SAMPLE_MULTIPLE !== 0 || echoChunkBytes < minChunk) {
    errors.push(`ECHO_CHUNK_BYTES must be a multiple of ${SAMPLE_MULTIPLE} between ${minChunk} and ${MAX_CHUNK}`);
  }

  const levelRaw = str('LOG_LEVEL') ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(levelRaw)) errors.push('LOG_LEVEL must be debug, info, warn or error');

  const cfg: Config = {
    port: int('PORT', 8080, 0, 65535),
    publicHost,
    authMode,
    basicUser,
    basicPassword,
    tokenSecret,
    sampleRate: rate as SampleRate,
    handler: str('HANDLER') ?? 'echo',
    echoChunkBytes,
    allowSmallChunks,
    mediaTimeoutSeconds: int('MEDIA_TIMEOUT_SECONDS', 10, 1),
    frameLogDir: str('FRAME_LOG_DIR'),
    recordRawAudio: bool('RECORD_RAW_AUDIO', false),
    logLevel: levelRaw as Level,
    maxConcurrentCalls: int('MAX_CONCURRENT_CALLS', 20, 1),
    shutdownGraceSeconds: int('SHUTDOWN_GRACE_SECONDS', 120, 0),
  };
  if (errors.length) throw new ConfigError(errors);
  return cfg;
}
