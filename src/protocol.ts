export interface StreamFormat {
  encoding: string;
  sampleRate: number;
  bitRate?: string;
}

export type StreamEvent =
  | { type: 'connected' }
  | {
      type: 'start';
      streamSid: string;
      callSid: string;
      accountSid?: string;
      from?: string;
      to?: string;
      format: StreamFormat;
      customParameters: Record<string, string>;
      fields: Record<string, unknown>;
    }
  | { type: 'media'; payload: Buffer; discarded: boolean; chunk?: number; timestamp?: number }
  | { type: 'dtmf'; digit: string; duration?: number }
  | { type: 'stop'; reason?: string; callSid?: string }
  | { type: 'mark'; name: string };

export type DecodeResult = { ok: true; event: StreamEvent } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** Never throws. Unknown fields are ignored; numeric fields may be numbers or strings. */
export function decodeFrame(text: string): DecodeResult {
  try {
    return decodeInner(text);
  } catch (e) {
    return { ok: false, error: `decode failure: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function decodeInner(text: string): DecodeResult {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (!isObj(msg)) return { ok: false, error: 'frame is not a JSON object' };
  const event = msg.event;
  switch (event) {
    case 'connected':
      return { ok: true, event: { type: 'connected' } };
    case 'start': {
      const s = msg.start;
      if (!isObj(s)) return { ok: false, error: 'start: missing start object' };
      const streamSid = str(s.stream_sid) ?? str(msg.stream_sid);
      const callSid = str(s.call_sid);
      const mf = s.media_format;
      const sampleRate = isObj(mf) ? num(mf.sample_rate) : undefined;
      if (!streamSid) return { ok: false, error: 'start: missing stream_sid' };
      if (!callSid) return { ok: false, error: 'start: missing call_sid' };
      if (!isObj(mf) || sampleRate === undefined) return { ok: false, error: 'start: missing media_format.sample_rate' };
      const custom: Record<string, string> = {};
      if (isObj(s.custom_parameters)) {
        for (const [k, v] of Object.entries(s.custom_parameters)) {
          const sv = str(v);
          if (sv !== undefined) custom[k] = sv;
        }
      }
      return {
        ok: true,
        event: {
          type: 'start',
          streamSid,
          callSid,
          accountSid: str(s.account_sid),
          from: str(s.from),
          to: str(s.to),
          format: { encoding: str(mf.encoding) ?? 'unknown', sampleRate, bitRate: str(mf.bit_rate) },
          customParameters: custom,
          fields: s,
        },
      };
    }
    case 'media': {
      const m = msg.media;
      if (!isObj(m) || typeof m.payload !== 'string') return { ok: false, error: 'media: missing payload' };
      const payload = Buffer.from(m.payload, 'base64');
      const discarded = payload.length === 0 || payload.length % 2 !== 0;
      return {
        ok: true,
        event: { type: 'media', payload: discarded ? Buffer.alloc(0) : payload, discarded, chunk: num(m.chunk), timestamp: num(m.timestamp) },
      };
    }
    case 'dtmf': {
      const d = msg.dtmf;
      const digit = isObj(d) ? str(d.digit) : undefined;
      if (!digit) return { ok: false, error: 'dtmf: missing digit' };
      return { ok: true, event: { type: 'dtmf', digit, duration: isObj(d) ? num(d.duration) : undefined } };
    }
    case 'stop': {
      const s = isObj(msg.stop) ? msg.stop : {};
      return { ok: true, event: { type: 'stop', reason: str(s.reason), callSid: str(s.call_sid) } };
    }
    case 'mark': {
      const m = msg.mark;
      const name = isObj(m) ? str(m.name) : undefined;
      if (!name) return { ok: false, error: 'mark: missing name' };
      return { ok: true, event: { type: 'mark', name } };
    }
    default:
      return { ok: false, error: `unknown event: ${typeof event === 'string' ? event.slice(0, 40) : typeof event}` };
  }
}

export const outbound = {
  media: (streamSid: string, seq: number, pcm: Buffer) => ({
    event: 'media',
    stream_sid: streamSid,
    sequence_number: seq,
    media: { payload: pcm.toString('base64') },
  }),
  mark: (streamSid: string, seq: number, name: string) => ({
    event: 'mark',
    stream_sid: streamSid,
    sequence_number: seq,
    mark: { name },
  }),
  clear: (streamSid: string) => ({ event: 'clear', stream_sid: streamSid }),
};
