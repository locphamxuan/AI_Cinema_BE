import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_ID = /^[\w-]{8,64}$/;

/** Tags every request with an id (kept from the caller when well-formed) and echoes it back. */
export function requestIdMiddleware(request: Request, response: Response, next: NextFunction) {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  request.headers[REQUEST_ID_HEADER] = id;
  response.setHeader(REQUEST_ID_HEADER, id);
  next();
}
