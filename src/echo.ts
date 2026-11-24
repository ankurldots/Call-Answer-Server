import { tone } from './chunker.js';
import type { CallHandler, HandlerFactory } from './handler.js';

const BURST_IDLE_MS = 500;

export const createEchoHandler: HandlerFactory = (out, { log, config }): CallHandler => {
  let rate: number = config.sampleRate;
  let buf: Buffer = Buffer.alloc(0);
  let idle: NodeJS.Timeout | undefined;
  let unmarked = false;
  let seq = 0;
  const markSentAt = new Map<string, number>();

  const endBurst = () => {
    if (buf.length > 0) {
      out.sendAudio(buf);
      buf = Buffer.alloc(0);
      unmarked = true;
    }
    if (unmarked) {
      const name = `echo-${++seq}`;
      markSentAt.set(name, performance.now());
      out.sendMark(name);
      unmarked = false;
    }
  };

  return {
    onStart(call) {
      rate = call.format.sampleRate;
      log.info('echo.start', { sampleRate: rate, chunkBytes: config.echoChunkBytes });
    },
    onAudio(pcm) {
      buf = Buffer.concat([buf, pcm]);
      while (buf.length >= config.echoChunkBytes) {
        out.sendAudio(buf.subarray(0, config.echoChunkBytes));
        buf = buf.subarray(config.echoChunkBytes);
        unmarked = true;
      }
      clearTimeout(idle);
      idle = setTimeout(endBurst, BURST_IDLE_MS);
    },
    onMark(name) {
      const t = markSentAt.get(name);
      markSentAt.delete(name);
      log.info('echo.mark_returned', { name, roundTripMs: t === undefined ? null : Math.round(performance.now() - t) });
    },
    onDtmf(digit) {
      if (digit === '#') {
        const queuedBytes = out.clear();
        buf = Buffer.alloc(0);
        log.info('echo.clear_sent', { queuedBytes, at: Math.round(performance.now()) });
      } else if (digit === '*') {
        out.sendAudio(tone(rate, 1000));
        unmarked = true;
        endBurst();
      }
    },
    end() {
      clearTimeout(idle);
      markSentAt.clear();
    },
  };
};
