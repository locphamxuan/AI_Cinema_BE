import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditEntity, ContentEvent } from './content-events';

export interface AuditEntry {
  action: ContentEvent;
  entityType: AuditEntity;
  entityId: string;
  movieId: string;
  /** null for events the system raises on its own (queue worker, scheduler). */
  actorId: string | null;
  payload?: Record<string, unknown>;
}

const DEFAULT_LIMIT = 100;

/** Append-only content events (§4.1.6), written in the transaction of the change they describe. */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        movieId: entry.movieId,
        actorType: entry.actorId ? 'USER' : 'SYSTEM',
        actorId: entry.actorId,
        payload: entry.payload as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /** A movie's events, newest first, with whoever triggered each one. */
  findForMovie(movieId: string, limit = DEFAULT_LIMIT) {
    return this.prisma.auditLog.findMany({
      where: { movieId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, fullName: true, role: true } } },
    });
  }
}
