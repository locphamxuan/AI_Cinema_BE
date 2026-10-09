import { unlink } from 'node:fs/promises';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';

/**
 * Deletes the temporary file a disk-storage FileInterceptor wrote, however the request ends:
 * validation pipes and the handler both run inside this interceptor, so a rejected upload
 * leaves nothing behind. List it after the FileInterceptor.
 */
@Injectable()
export class RemoveTempUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      finalize(() => {
        const file = request.file;
        if (file?.path) void unlink(file.path).catch(() => undefined);
      }),
    );
  }
}
