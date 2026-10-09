import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

const isPlainData = (value: unknown): value is object =>
  Boolean(value) &&
  typeof value === 'object' &&
  !(value instanceof Date) &&
  !(value instanceof StreamableFile) &&
  !Buffer.isBuffer(value);

/** Recursively turns BigInt (Token amounts, file sizes) into numbers, which JSON can encode. */
function withoutBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(withoutBigInt);
  if (isPlainData(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withoutBigInt(inner)]));
  }
  return value;
}

@Injectable()
export class BigIntJsonInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(withoutBigInt));
  }
}
