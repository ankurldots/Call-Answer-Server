import { SAMPLE_MULTIPLE } from './config.js';

type Item = { kind: 'audio'; data: Buffer } | { kind: 'mark'; name: string };

export interface PacerSink {
  media(chunk: Buffer): void;
  mark(name: string): void;
}

/**
 * Chunks PCM into fixed-size pieces and sends them no faster than real time.
 * A partial chunk is held until more audio arrives or a mark flushes it (padded with silence).
 */
export class Pacer {
  private queue: Item[] = [];
  private pending: Buffer = Buffer.alloc(0);
  private timer?: NodeJS.Timeout;
  private nextAt = 0;
  private stopped = false;

  constructor(
    private readonly chunkBytes: number,
    private readonly sampleRate: number,
    private readonly sink: PacerSink,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (chunkBytes % SAMPLE_MULTIPLE !== 0) throw new RangeError('chunkBytes must be a multiple of 320');
  }

  sendAudio(pcm: Buffer): void {
    if (pcm.length === 0) return;
    this.queue.push({ kind: 'audio', data: pcm });
    this.pump();
  }

  sendMark(name: string): void {
    this.queue.push({ kind: 'mark', name });
    this.pump();
  }

  clear(): number {
    let bytes = this.pending.length;
    for (const i of this.queue) if (i.kind === 'audio') bytes += i.data.length;
    this.queue = [];
    this.pending = Buffer.alloc(0);
    this.nextAt = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
    return bytes;
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private pump = (): void => {
    this.timer = undefined;
    while (!this.stopped) {
      const unit = this.nextUnit();
      if (!unit) return;
      const wait = this.nextAt - this.now();
      if (wait > 0) {
        this.requeue(unit);
        this.timer = setTimeout(this.pump, wait);
        return;
      }
      const durationMs = (unit.length / 2 / this.sampleRate) * 1000;
      this.nextAt = Math.max(this.nextAt, this.now()) + durationMs;
      this.sink.media(unit);
    }
  };

  /** Returns the next chunk to send, emitting marks that are ready along the way. */
  private nextUnit(): Buffer | undefined {
    for (;;) {
      if (this.pending.length >= this.chunkBytes) {
        const chunk = this.pending.subarray(0, this.chunkBytes);
        this.pending = this.pending.subarray(this.chunkBytes);
        return chunk;
      }
      const head = this.queue[0];
      if (!head) return undefined;
      if (head.kind === 'audio') {
        this.queue.shift();
        this.pending = Buffer.concat([this.pending, head.data]);
        continue;
      }
      if (this.pending.length > 0) {
        const padded = Buffer.alloc(this.chunkBytes);
        this.pending.copy(padded);
        this.pending = Buffer.alloc(0);
        return padded;
      }
      this.queue.shift();
      this.sink.mark(head.name);
    }
  }

  /** Puts a chunk back at the front so it is sent when its time comes. */
  private requeue(chunk: Buffer): void {
    this.pending = Buffer.concat([chunk, this.pending]);
  }
}
