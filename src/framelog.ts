import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './logger.js';

export const safeName = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);

/** Per-call frame record. Never receives payload content or secrets; callers pass only metadata. */
export class FrameLog {
  private file?: WriteStream;
  private pcm?: WriteStream;

  constructor(
    private readonly log: Logger,
    dir: string | undefined,
    callSid: string,
    recordRaw: boolean,
  ) {
    if (dir) {
      mkdirSync(dir, { recursive: true });
      const base = join(dir, safeName(callSid));
      this.file = createWriteStream(`${base}.jsonl`, { flags: 'a' });
      this.file.on('error', (e) => log.warn('framelog.file_error', { error: e.message }));
      if (recordRaw) {
        this.pcm = createWriteStream(`${base}.pcm`, { flags: 'a' });
        this.pcm.on('error', (e) => log.warn('framelog.pcm_error', { error: e.message }));
      }
    }
  }

  frame(direction: 'in' | 'out', event: string, bytes: number, fields: Record<string, unknown> = {}): void {
    const line = { direction, event, bytes, t: Math.round(performance.now()), ...fields };
    this.log.debug('frame', line);
    this.file?.write(JSON.stringify(line) + '\n');
  }

  audio(pcm: Buffer): void {
    this.pcm?.write(pcm);
  }

  summary(fields: Record<string, unknown>): void {
    this.log.info('call.summary', fields);
    this.file?.write(JSON.stringify({ event: 'summary', ...fields }) + '\n');
  }

  close(): void {
    this.file?.end();
    this.pcm?.end();
  }
}
