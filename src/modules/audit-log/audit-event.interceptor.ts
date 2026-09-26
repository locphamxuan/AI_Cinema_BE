import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable, switchMap } from 'rxjs';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/prisma/prisma.service';
import { AUDIT_EVENT_KEY, type AuditContext, type AuditEventOptions } from './audit-event.decorator';
import { AuditLogService } from './audit-log.service';

interface AuditedRequest {
  user?: AuthenticatedUser;
  params: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/** Writes the @AuditEvent of a handler after it succeeds; failed requests leave no event. */
@Injectable()
export class AuditEventInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditEventOptions | undefined>(AUDIT_EVENT_KEY, context.getHandler());
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    return next
      .handle()
      .pipe(
        switchMap((response: unknown) =>
          from(this.write(options, request, (response ?? {}) as Record<string, unknown>).then(() => response)),
        ),
      );
  }

  private async write(options: AuditEventOptions, request: AuditedRequest, response: Record<string, unknown>) {
    const ctx: AuditContext = { params: request.params, body: request.body ?? {}, response, prisma: this.prisma };
    const action = typeof options.action === 'function' ? await options.action(ctx) : options.action;
    const entityId = options.idParam ? request.params[options.idParam] : response.id;
    if (!action || typeof entityId !== 'string') return;

    await this.auditLog.record({
      action,
      entityType: options.entity,
      entityId,
      actorId: request.user?.id ?? null,
      payload: options.payload?.(ctx),
    });
  }
}
