import type { RawData, WebSocket } from 'ws';
import type { Config } from './config.js';
import { FrameLog } from './framelog.js';
import type { CallHandler, CallInfo, HandlerFactory } from './handler.js';
import type { Logger } from './logger.js';
import { Pacer } from './pacer.js';
import { decodeFrame, outbound, type StreamEvent, type StreamFormat } from './protocol.js';
import type { TokenUseStore } from './stores.js';

const START_TIMEOUT_MS = 10_000;
const WS_OPEN = 1;

export interface SessionDeps {
  config: Config;
  log: Logger;
  factory: HandlerFactory;
  tokenUse: TokenUseStore;
  token: string;
  tokenCallSid: string;
  tokenExp: number;
}

export class CallSession {
  private handler?: CallHandler;
  private pacer?: Pacer;
  private streamSid = '';
  private format?: StreamFormat;
  private ended = false;
  private startTimer?: NodeJS.Timeout;
  private mediaTimer?: NodeJS.Timeout;
  private seq = 0;
  private stopReason?: string;
  private closeCode?: number;
  private readonly t0 = performance.now();
  private readonly frames: FrameLog;
  private readonly log: Logger;
  private readonly stats = { inMedia: 0, outMedia: 0, discarded: 0, protocolErrors: 0 };
  private readonly inSizes = new Map<number, number>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ws: WebSocket,
    private readonly deps: SessionDeps,
    private readonly onEnded: () => void,
  ) {
    this.log = deps.log.child({ callSid: deps.tokenCallSid });
    this.frames = new FrameLog(this.log, deps.config.frameLogDir, deps.tokenCallSid, deps.config.recordRawAudio);
  }

  begin(): void {
    this.ws.on('message', (data: RawData, isBinary: boolean) => this.onMessage(data, isBinary));
    this.ws.on('close', (code: number) => {
      this.closeCode ??= code;
      void this.end('socket_closed');
    });
    this.ws.on('error', (e: Error) => {
      this.log.warn('socket.error', { error: e.message });
      void this.end('socket_closed');
    });
    this.startTimer = setTimeout(() => {
      this.log.warn('start.timeout');
      void this.end('start_timeout', 1008);
    }, START_TIMEOUT_MS);
  }

  /** Ends the call once. Safe to call repeatedly. */
  async end(reason: string, closeCode?: number): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.startTimer);
    clearTimeout(this.mediaTimer);
    this.pacer?.stop();
    this.stopReason ??= reason;
    try {
      await this.handler?.end(reason);
    } catch (e) {
      this.log.error('handler.end_failed', { error: errMsg(e) });
    }
    if (this.ws.readyState === WS_OPEN || this.ws.readyState === 0) {
      try {
        this.ws.close(closeCode ?? 1000);
      } catch (e) {
        this.log.warn('socket.close_failed', { error: errMsg(e) });
      }
    }
    this.closeCode ??= closeCode;
    this.writeSummary(reason);
    this.frames.close();
    this.onEnded();
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (this.ended) return;
    if (isBinary) {
      this.stats.protocolErrors++;
      this.frames.frame('in', 'PROTOCOL_ERROR', rawLen(data), { error: 'binary frame' });
      return;
    }
    const text = rawToString(data);
    const res = decodeFrame(text);
    if (!res.ok) {
      this.stats.protocolErrors++;
      this.frames.frame('in', 'PROTOCOL_ERROR', Buffer.byteLength(text), { error: res.error });
      return;
    }
    const ev = res.event;
    switch (ev.type) {
      case 'connected':
        this.frames.frame('in', 'connected', Buffer.byteLength(text));
        return;
      case 'start': {
        this.frames.frame('in', 'start', Buffer.byteLength(text), { start: ev.fields });
        this.log.info('call.start', { start: ev.fields });
        this.onStart(ev);
        return;
      }
      case 'media': {
        this.stats.inMedia++;
        if (ev.discarded) {
          this.stats.discarded++;
          this.frames.frame('in', 'media', Buffer.byteLength(text), { discarded: true });
          return;
        }
        this.inSizes.set(ev.payload.length, (this.inSizes.get(ev.payload.length) ?? 0) + 1);
        this.frames.frame('in', 'media', ev.payload.length, { chunk: ev.chunk, timestamp: ev.timestamp });
        this.frames.audio(ev.payload);
        this.armMediaTimer();
        if (this.handler && this.format) {
          const fmt = this.format;
          this.run((h) => h.onAudio(ev.payload, fmt));
        }
        return;
      }
      case 'dtmf':
        this.frames.frame('in', 'dtmf', Buffer.byteLength(text), { digit: ev.digit, duration: ev.duration });
        this.run((h) => h.onDtmf(ev.digit));
        return;
      case 'mark':
        this.frames.frame('in', 'mark', Buffer.byteLength(text), { name: ev.name });
        this.run((h) => h.onMark(ev.name));
        return;
      case 'stop':
        this.frames.frame('in', 'stop', Buffer.byteLength(text), { reason: ev.reason });
        void this.end(ev.reason === 'callended' ? 'callended' : 'stopped');
        return;
    }
  }

  private onStart(ev: Extract<StreamEvent, { type: 'start' }>): void {
    if (this.handler) return; // a second start is ignored
    clearTimeout(this.startTimer);
    if (ev.callSid !== this.deps.tokenCallSid) {
      this.log.warn('start.call_sid_mismatch');
      void this.end('call_sid_mismatch', 1008);
      return;
    }
    if (!this.deps.tokenUse.tryUse(this.deps.token, this.deps.tokenExp)) {
      this.log.warn('start.token_reused');
      void this.end('token_reused', 1008);
      return;
    }
    this.streamSid = ev.streamSid;
    this.format = ev.format;
    const cfg = this.deps.config;
    this.pacer = new Pacer(cfg.echoChunkBytes, ev.format.sampleRate, {
      media: (chunk) => {
        this.stats.outMedia++;
        this.send('media', chunk.length, outbound.media(this.streamSid, ++this.seq, chunk));
      },
      mark: (name) => this.send('mark', 0, outbound.mark(this.streamSid, ++this.seq, name), { name }),
    });
    const pacer = this.pacer;
    try {
      this.handler = this.deps.factory(
        {
          sendAudio: (pcm) => pacer.sendAudio(pcm),
          sendMark: (name) => pacer.sendMark(name),
          clear: () => {
            const queued = pacer.clear();
            this.send('clear', 0, outbound.clear(this.streamSid), { queuedBytes: queued });
            return queued;
          },
        },
        { log: this.log, config: cfg },
      );
    } catch (e) {
      this.log.error('handler.create_failed', { error: errMsg(e) });
      void this.end('handler_error', 1011);
      return;
    }
    const info: CallInfo = {
      callSid: ev.callSid,
      streamSid: ev.streamSid,
      from: ev.from,
      to: ev.to,
      customParameters: ev.customParameters,
      format: ev.format,
    };
    this.armMediaTimer();
    this.run((h) => h.onStart(info));
  }

  /** Runs handler calls one after another; any failure ends the call with handler_error. */
  private run(fn: (h: CallHandler) => void | Promise<void>): void {
    const h = this.handler;
    if (!h) return;
    this.chain = this.chain.then(async () => {
      if (this.ended) return;
      try {
        await fn(h);
      } catch (e) {
        this.log.error('handler.error', { error: errMsg(e) });
        await this.end('handler_error', 1011);
      }
    });
  }

  private armMediaTimer(): void {
    clearTimeout(this.mediaTimer);
    this.mediaTimer = setTimeout(() => {
      this.log.warn('media.timeout');
      void this.end('media_timeout', 1001);
    }, this.deps.config.mediaTimeoutSeconds * 1000);
  }

  private send(event: string, bytes: number, msg: object, fields: Record<string, unknown> = {}): void {
    if (this.ended || this.ws.readyState !== WS_OPEN) return;
    this.frames.frame('out', event, bytes, { ...fields, sequence_number: (msg as { sequence_number?: number }).sequence_number });
    this.ws.send(JSON.stringify(msg));
  }

  private writeSummary(reason: string): void {
    let mostFrequent: number | null = null;
    let best = 0;
    for (const [size, n] of this.inSizes) {
      if (n > best) {
        best = n;
        mostFrequent = size;
      }
    }
    const sizes = [...this.inSizes.keys()];
    this.frames.summary({
      durationMs: Math.round(performance.now() - this.t0),
      inboundMedia: this.stats.inMedia,
      outboundMedia: this.stats.outMedia,
      inboundChunkMin: sizes.length ? Math.min(...sizes) : null,
      inboundChunkMax: sizes.length ? Math.max(...sizes) : null,
      inboundChunkMostFrequent: mostFrequent,
      stopReason: this.stopReason ?? reason,
      closeCode: this.closeCode ?? null,
      discardedFrames: this.stats.discarded,
      protocolErrors: this.stats.protocolErrors,
    });
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const rawLen = (d: RawData): number =>
  Array.isArray(d) ? d.reduce((n, b) => n + b.length, 0) : d instanceof ArrayBuffer ? d.byteLength : d.length;
const rawToString = (d: RawData): string =>
  Array.isArray(d) ? Buffer.concat(d).toString('utf8') : d instanceof ArrayBuffer ? Buffer.from(d).toString('utf8') : d.toString('utf8');
