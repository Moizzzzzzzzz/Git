import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

// The edge overwrites this header. It selects a preconfigured endpoint, never a URL.
const mediaOrigin = new AsyncLocalStorage<'domain' | 'ip'>();
export function mediaOriginMiddleware(req: Request, _res: Response, next: NextFunction): void {
  mediaOrigin.run(req.headers['x-fabricqc-media-origin'] === 'domain' ? 'domain' : 'ip', next);
}
export function useDomainMediaOrigin(): boolean {
  return mediaOrigin.getStore() === 'domain';
}
