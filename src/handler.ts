import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { StreamFormat } from './protocol.js';

export interface CallInfo {
  callSid: string;
  streamSid: string;
  from?: string;
  to?: string;
  customParameters: Record<string, string>;
  format: StreamFormat;
}

export interface HandlerOutput {
  /** PCM s16le mono at the stream rate, any length. The protocol layer chunks and paces it. */
  sendAudio(pcm: Buffer): void;
  /** Queued after all audio sent so far; any partial chunk is padded with silence first. */
  sendMark(name: string): void;
  /** Drops queued audio and sends `clear`. Returns the number of bytes dropped. */
  clear(): number;
}

export interface CallHandler {
  onStart(call: CallInfo): void | Promise<void>;
  onAudio(pcm: Buffer, format: StreamFormat): void | Promise<void>;
  onMark(name: string): void | Promise<void>;
  onDtmf(digit: string): void | Promise<void>;
  end(reason: string): void | Promise<void>;
}

export interface HandlerContext {
  log: Logger;
  config: Config;
}

export type HandlerFactory = (out: HandlerOutput, ctx: HandlerContext) => CallHandler;
