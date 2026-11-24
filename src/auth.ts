import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

export function checkBasic(header: string | undefined, user: string, password: string): boolean {
  if (!header) return false;
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (!m) return false;
  const decoded = Buffer.from(m[1] as string, 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const okUser = timingSafeEqual(digest(decoded.slice(0, idx)), digest(user));
  const okPass = timingSafeEqual(digest(decoded.slice(idx + 1)), digest(password));
  return okUser && okPass;
}

/** Describes the Authorization header without revealing it. */
export function authHeaderInfo(req: IncomingMessage): { present: boolean; scheme?: string } {
  const h = req.headers.authorization;
  if (!h) return { present: false };
  return { present: true, scheme: h.split(/\s+/)[0]?.toLowerCase() };
}
