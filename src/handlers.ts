import { createEchoHandler } from './echo.js';
import type { HandlerFactory } from './handler.js';

const registry: Record<string, HandlerFactory> = { echo: createEchoHandler };

export function getHandlerFactory(name: string): HandlerFactory {
  const f = registry[name];
  if (!f) throw new Error(`Unknown HANDLER "${name}". Known: ${Object.keys(registry).join(', ')}`);
  return f;
}
