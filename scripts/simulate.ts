/* Plays the role of Exotel: resolve -> open stream -> send a tone -> print what comes back. */
import { WebSocket } from 'ws';
import { tone } from '../src/chunker.js';

const base = process.env.SIM_BASE_URL ?? `http://localhost:${process.env.PORT ?? '8080'}`;
const rate = Number(process.env.SAMPLE_RATE ?? '8000');
const user = process.env.EXOTEL_BASIC_USER;
const pass = process.env.EXOTEL_BASIC_PASSWORD;
const headers: Record<string, string> =
  process.env.AUTH_MODE !== 'none' && user && pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const callSid = `SIM${Date.now()}`;

const res = await fetch(`${base}/exotel/resolve?CallSid=${callSid}&CallTo=%2B910000000000`, { headers });
if (!res.ok) throw new Error(`resolve failed: HTTP ${res.status}`);
const { url } = (await res.json()) as { url: string };
console.log('resolve ->', url.replace(/\/stream\/[^?]+/, '/stream/<token>'));

// Local runs reach the server over plain ws, whatever PUBLIC_HOST says.
const wsBase = base.replace(/^http/, 'ws');
const wsUrl = wsBase + url.slice(url.indexOf('/stream/'));
const ws = new WebSocket(wsUrl, { headers });
let outFrames = 0;
let outBytes = 0;
ws.on('message', (d) => {
  const m = JSON.parse(d.toString()) as { event: string; media?: { payload: string }; mark?: { name: string } };
  if (m.event === 'media') {
    outFrames++;
    outBytes += Buffer.from(m.media?.payload ?? '', 'base64').length;
  } else {
    console.log('<-', m.event, m.mark?.name ?? '');
    if (m.event === 'mark') ws.send(JSON.stringify({ event: 'mark', stream_sid: 'sim', mark: { name: m.mark?.name } }));
  }
});
ws.on('unexpected-response', (_q, r) => {
  console.error('handshake refused: HTTP', r.statusCode);
  process.exit(1);
});
await new Promise((r) => ws.once('open', r));
ws.send(JSON.stringify({ event: 'connected' }));
ws.send(
  JSON.stringify({
    event: 'start',
    sequence_number: '1',
    stream_sid: 'sim',
    start: { stream_sid: 'sim', call_sid: callSid, account_sid: 'sim', from: '+910000000001', to: '+910000000000', custom_parameters: {}, media_format: { encoding: 'base64', sample_rate: String(rate), bit_rate: '128kbps' } },
  }),
);

const pcm = tone(rate, 2000);
const frameBytes = 320; // 20 ms at 8 kHz; fine for any rate
for (let off = 0, n = 0; off < pcm.length; off += frameBytes, n++) {
  ws.send(JSON.stringify({ event: 'media', stream_sid: 'sim', media: { chunk: String(n + 1), timestamp: String(n * 20), payload: pcm.subarray(off, off + frameBytes).toString('base64') } }));
  await new Promise((r) => setTimeout(r, 20));
}
await new Promise((r) => setTimeout(r, 1500));
console.log(`received ${outFrames} media frames, ${outBytes} bytes`);
ws.send(JSON.stringify({ event: 'stop', stream_sid: 'sim', stop: { call_sid: callSid, reason: 'callended' } }));
ws.close();
