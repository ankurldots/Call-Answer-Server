import { SAMPLE_MULTIPLE } from './config.js';

/**
 * Splits PCM into chunks of exactly chunkBytes. The last chunk is padded with silence.
 * The concatenation of the result equals the input followed by zero padding.
 */
export function chunkPcm(pcm: Buffer, chunkBytes: number): Buffer[] {
  if (chunkBytes <= 0 || chunkBytes % SAMPLE_MULTIPLE !== 0) throw new RangeError('chunkBytes must be a positive multiple of 320');
  const out: Buffer[] = [];
  for (let off = 0; off < pcm.length; off += chunkBytes) {
    const slice = pcm.subarray(off, off + chunkBytes);
    if (slice.length === chunkBytes) out.push(slice);
    else {
      const padded = Buffer.alloc(chunkBytes);
      slice.copy(padded);
      out.push(padded);
    }
  }
  return out;
}

export function tone(sampleRate: number, ms: number, hz = 440, amplitude = 8000): Buffer {
  const n = Math.floor((sampleRate * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate)), i * 2);
  return buf;
}
