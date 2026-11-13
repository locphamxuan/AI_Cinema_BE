import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * The error codes of RFC 6749 §4.1.2.1 and §5.2 (plus `insufficient_scope`, RFC 6750 §3.1). They are part
 * of the contract with Studio Web, so they are never translated or renamed.
 */
export const OAUTH_ERROR = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_CLIENT: 'invalid_client',
  INVALID_GRANT: 'invalid_grant',
  UNAUTHORIZED_CLIENT: 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
  UNSUPPORTED_RESPONSE_TYPE: 'unsupported_response_type',
  INVALID_SCOPE: 'invalid_scope',
  ACCESS_DENIED: 'access_denied',
  SERVER_ERROR: 'server_error',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
} as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR)[keyof typeof OAUTH_ERROR];

export interface OAuthErrorBody {
  error: OAuthErrorCode;
  error_description: string;
}

/**
 * An OAuth failure. It leaves the API in the shape RFC 6749 §5.2 defines — `{ error, error_description }`
 * at the top level — instead of the platform's `{ error: { code, message } }` envelope, because Studio Web
 * and every OAuth library read the RFC shape.
 */
export class OAuthError extends HttpException {
  constructor(
    readonly code: OAuthErrorCode,
    description: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ error: code, error_description: description } satisfies OAuthErrorBody, status);
  }

  /** RFC 6749 §5.2: a client that fails to authenticate is answered 401 with a WWW-Authenticate header. */
  static invalidClient(description: string): OAuthError {
    return new OAuthError(OAUTH_ERROR.INVALID_CLIENT, description, HttpStatus.UNAUTHORIZED);
  }
}

/** Writes OAuthError in the RFC shape; every other error still goes to the platform-wide filter. */
@Catch(OAuthError)
export class OAuthExceptionFilter implements ExceptionFilter {
  catch(exception: OAuthError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    if (status === Number(HttpStatus.UNAUTHORIZED)) {
      response.setHeader('WWW-Authenticate', `Basic realm="ai-cinema", error="${exception.code}"`);
    }
    // RFC 6749 §5.1: a token response, success or failure, is never cached.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.status(status).json(exception.getResponse());
  }
}
