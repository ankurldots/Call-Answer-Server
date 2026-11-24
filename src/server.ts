import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { authHeaderInfo, checkBasic } from './auth.js';
import type { Config } from './config.js';
import type { HandlerFactory } from './handler.js';
import type { Logger } from './logger.js';
import { CallSession } from './session.js';
import { InMemoryCallRegistry, InMemoryTokenUseStore, type CallRegistry, type TokenUseStore } from './stores.js';
import { createToken, verifyToken } from './token.js';

const MAX_BODY = 64 * 1024;

export interface WsServer {
  http: Server;
  registry: CallRegistry;
  listen(): Promise<number>;
  shutdown(): Promise<void>;
}

export interface ServerOptions {
  config: Config;
  log: Logger;
  factory: HandlerFactory;
  tokenUse?: TokenUseStore;
  registry?: CallRegistry;
}

export function createWsServer(opts: ServerOptions): WsServer {
  const { config, log, factory } = opts;
  const tokenUse = opts.tokenUse ?? new InMemoryTokenUseStore();
  const registry = opts.registry ?? new InMemoryCallRegistry(config.maxConcurrentCalls);
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  let shuttingDown = false;

  const authOk = (req: IncomingMessage): boolean =>
    config.authMode === 'none' || checkBasic(req.headers.authorization, config.basicUser, config.basicPassword);

  const http = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.error('http.error', { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) text(res, 500, 'internal error');
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (shuttingDown) return text(res, 503, 'shutting down');
    if (url.pathname === '/health' && req.method === 'GET') {
      return json(res, 200, { status: 'ok', activeCalls: registry.count() });
    }
    if (url.pathname === '/exotel/resolve' && (req.method === 'GET' || req.method === 'POST')) {
      return resolve(req, res, url);
    }
    return text(res, 404, 'not found');
  }

  async function resolve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const auth = authHeaderInfo(req);
    const params = new URLSearchParams(url.searchParams);
    if (req.method === 'POST') {
      const body = await readBody(req);
      for (const [k, v] of new URLSearchParams(body)) if (!params.has(k)) params.set(k, v);
    }
    const callSid = params.get('CallSid') ?? undefined;
    const callTo = params.get('CallTo') ?? params.get('To') ?? undefined;
    const done = (status: number, outcome: string) =>
      log.info('resolve', { callSid, callTo, outcome, authHeaderPresent: auth.present });

    if (!authOk(req)) {
      done(401, 'unauthorized');
      res.setHeader('WWW-Authenticate', 'Basic realm="exotel"');
      return text(res, 401, 'unauthorized');
    }
    if (!callSid) {
      done(400, 'missing_call_sid');
      return text(res, 400, 'CallSid is required');
    }
    const token = createToken(config.tokenSecret, callSid);
    done(200, 'ok');
    json(res, 200, { url: `wss://${config.publicHost}/stream/${token}?sample-rate=${config.sampleRate}` });
  }

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const refuse = (status: number, reason: string, outcome: string) => {
      log.warn('handshake.refused', { outcome, authHeaderPresent: authHeaderInfo(req).present });
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (shuttingDown) return refuse(503, 'Service Unavailable', 'shutting_down');
    const m = /^\/stream\/([^/?]+)(?:\?|$)/.exec(req.url ?? '');
    if (!m) return refuse(404, 'Not Found', 'bad_path');
    if (!authOk(req)) return refuse(401, 'Unauthorized', 'basic_auth_failed');
    const token = m[1] as string;
    const verified = verifyToken(config.tokenSecret, token);
    if (!verified) return refuse(401, 'Unauthorized', 'bad_token');
    if (!registry.tryAdd(verified.callSid)) {
      return refuse(503, 'Service Unavailable', 'capacity_or_duplicate');
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      const session = new CallSession(
        ws,
        { config, log, factory, tokenUse, token, tokenCallSid: verified.callSid, tokenExp: verified.exp },
        () => {
          sockets.delete(ws);
          registry.remove(verified.callSid);
        },
      );
      session.begin();
    });
  });

  return {
    http,
    registry,
    listen: () =>
      new Promise((resolveListen, reject) => {
        http.once('error', reject);
        http.listen(config.port, () => {
          const addr = http.address();
          resolveListen(typeof addr === 'object' && addr ? addr.port : config.port);
        });
      }),
    async shutdown() {
      shuttingDown = true;
      http.close();
      http.closeIdleConnections();
      const deadline = Date.now() + config.shutdownGraceSeconds * 1000;
      while (registry.count() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      for (const ws of sockets) ws.close(1001);
      await new Promise((r) => setTimeout(r, 100));
      http.closeAllConnections();
    },
  };
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
