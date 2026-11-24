import { ConfigError, loadConfig } from './config.js';
import { getHandlerFactory } from './handlers.js';
import { createLogger } from './logger.js';
import { createWsServer } from './server.js';

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) for (const m of e.errors) console.error(`config error: ${m}`);
  else console.error(e);
  process.exit(1);
}

const log = createLogger(config.logLevel);
let factory;
try {
  factory = getHandlerFactory(config.handler);
} catch (e) {
  console.error(`config error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

if (config.authMode === 'none') log.warn('AUTH_MODE=none: Basic authentication is disabled; only the call token protects the stream');
if (config.recordRawAudio) log.warn('RECORD_RAW_AUDIO=true: inbound caller audio is being written to disk');

process.on('uncaughtException', (e) => {
  log.error('uncaughtException', { error: e.message, stack: e.stack });
  process.exit(1);
});
process.on('unhandledRejection', (r) => {
  log.error('unhandledRejection', { error: r instanceof Error ? r.message : String(r) });
  process.exit(1);
});

const server = createWsServer({ config, log, factory });
const port = await server.listen();
log.info('listening', { port, handler: config.handler, sampleRate: config.sampleRate, maxConcurrentCalls: config.maxConcurrentCalls });

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info('shutdown.begin', { signal, graceSeconds: config.shutdownGraceSeconds });
  server.shutdown().then(
    () => process.exit(0),
    (e) => {
      log.error('shutdown.failed', { error: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    },
  );
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
