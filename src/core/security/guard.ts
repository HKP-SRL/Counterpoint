// The console's request guard. Not implemented yet: every middleware passes requests through.
import { createServer, type RequestListener, type Server, type ServerOptions } from 'node:http';
import type { MiddlewareHandler } from 'hono';
import type { Store } from '../store/db.ts';

export function hostCheckedServer(options: ServerOptions, listener: RequestListener): Server {
  return createServer(options, listener);
}

export type PortGetter = () => number;

export const CONSOLE_CSP = '';

const passThrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

export function hostGuard(_getPort: PortGetter): MiddlewareHandler {
  return passThrough;
}

export function mutationGuard(_getPort: PortGetter): MiddlewareHandler {
  return passThrough;
}

export function sseGuard(_getPort: PortGetter): MiddlewareHandler {
  return passThrough;
}

export function sessionGuard(_db: Store): MiddlewareHandler {
  return passThrough;
}

export function securityHeaders(): MiddlewareHandler {
  return passThrough;
}
