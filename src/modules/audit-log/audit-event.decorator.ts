import { SetMetadata } from '@nestjs/common';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { AuditEntity } from './audit-log.service';

export const AUDIT_EVENT_KEY = 'auditEvent';

export interface AuditContext {
  params: Record<string, string>;
  body: Record<string, unknown>;
  response: Record<string, unknown>;
  prisma: PrismaService;
}

export interface AuditEventOptions {
  /** The event name, or a function that picks it from the outcome (null records nothing). */
  action: string | ((ctx: AuditContext) => string | null | Promise<string | null>);
  entity: AuditEntity;
  /** Route param holding the entity id; without it the id of the response is used. */
  idParam?: string;
  payload?: (ctx: AuditContext) => Record<string, unknown>;
}

/** Records a production event once the handler has succeeded (see AuditEventInterceptor). */
export const AuditEvent = (options: AuditEventOptions) => SetMetadata(AUDIT_EVENT_KEY, options);
