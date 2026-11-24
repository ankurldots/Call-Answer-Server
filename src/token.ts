import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_SECONDS = 60;

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const sign = (secret: string, body: string): Buffer => createHmac('sha256', secret).update(body).digest();

/** Token format: base64url(callSid) "." expirySeconds "." base64url(hmacSha256(body)). URL path safe. */
export function createToken(secret: string, callSid: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS;
  const body = `${b64u(callSid)}.${exp}`;
  return `${body}.${b64u(sign(secret, body))}`;
}

export interface VerifiedToken {
  callSid: string;
  exp: number;
}

export function verifyToken(secret: string, token: string, nowMs: number = Date.now()): VerifiedToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sid, expStr, sig] = parts as [string, string, string];
  if (!/^\d{1,12}$/.test(expStr)) return null;
  const expected = sign(secret, `${sid}.${expStr}`);
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // Reject non-canonical encodings so that a modified string never verifies.
  if (b64u(given) !== sig) return null;
  const exp = Number(expStr);
  if (Math.floor(nowMs / 1000) > exp) return null;
  const callSid = Buffer.from(sid, 'base64url').toString('utf8');
  if (b64u(callSid) !== sid) return null;
  return { callSid, exp };
}
