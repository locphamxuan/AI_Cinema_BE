import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { REQUEST_ID_HEADER } from './request-id.middleware';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

// Prisma errors a client can cause (duplicate key, missing row, broken reference, failed CHECK).
const PRISMA_ERRORS: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'A record with the same unique value already exists' },
  P2003: { status: HttpStatus.CONFLICT, message: 'The record is referenced by, or refers to, a missing record' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'The record does not exist' },
  P2004: { status: HttpStatus.CONFLICT, message: 'The change breaks a business rule of the database' },
};

function fromHttpException(exception: HttpException): { status: number; message: string; details?: unknown } {
  const status = exception.getStatus();
  const body = exception.getResponse();
  if (typeof body === 'string') return { status, message: body };
  const { message } = body as { message?: string | string[] };
  // ValidationPipe reports one message per invalid field.
  if (Array.isArray(message)) return { status, message: 'The request is invalid', details: message };
  return { status, message: message ?? exception.message };
}

/**
 * Every error leaves the API as `{ error: { code, message, details }, requestId }`
 * (PROJECT_OVERVIEW.md §9). Unexpected errors are logged with their stack and answered
 * with a generic 500, so internals never reach the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.headers[REQUEST_ID_HEADER] as string | undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      ({ status, message, details } = fromHttpException(exception));
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && PRISMA_ERRORS[exception.code]) {
      ({ status, message } = PRISMA_ERRORS[exception.code]);
    } else {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.url} failed [${requestId ?? '-'}]`, stack);
    }

    const body: ApiErrorBody = {
      error: { code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'), message, details },
      requestId,
    };
    response.status(status).json(body);
  }
}
