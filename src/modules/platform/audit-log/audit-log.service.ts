import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditEntity, ContentEvent } from './content-events';

export interface AuditEntry {
  action: ContentEvent;
  entityType: AuditEntity;
  entityId: string;
  /** null for MF-2 events: a wallet, a plan or a Coin ledger row is not part of a movie project. */
  movieId: string | null;
  /** null for events the system raises on its own (queue worker, scheduler) or a studio raises. */
  actorId: string | null;
  /** 'STUDIO' for a studio on its portal link, 'GUEST' for an unauthenticated viewer: neither has an account. */
  actorType?: 'STUDIO' | 'GUEST';
  payload?: Record<string, unknown>;
}

const DEFAULT_LIMIT = 100;

/** The row shape both writers share; one place decides how an actor type is inferred. */
function auditRow(entry: AuditEntry) {
  return {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    movieId: entry.movieId,
    actorType: entry.actorType ?? (entry.actorId ? 'USER' : 'SYSTEM'),
    actorId: entry.actorId,
    payload: entry.payload as Prisma.InputJsonValue | undefined,
  };
}

/** Append-only content events (§4.1.6), written in the transaction of the change they describe. */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({ data: auditRow(entry) });
  }

  /**
   * P5-1: one INSERT for events raised together in a batch (the expiry sweep closes many
   * sessions at once). Same rows as record(), without one round trip per session.
   */
  async recordMany(entries: AuditEntry[], tx?: PrismaTx): Promise<void> {
    if (!entries.length) return;
    await (tx ?? this.prisma).auditLog.createMany({ data: entries.map(auditRow) });
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
