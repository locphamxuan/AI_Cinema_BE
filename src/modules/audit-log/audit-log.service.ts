import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/** The entities an event can be about; each one leads back to its production project. */
export type AuditEntity =
  | 'ProductionProject'
  | 'ProductionPlan'
  | 'PlanReview'
  | 'QuotaRequest'
  | 'GenerationJob'
  | 'EpisodePackage'
  | 'Review'
  | 'Episode'
  | 'Publication';

export interface AuditEntry {
  action: string;
  entityType: AuditEntity;
  entityId: string;
  /** null for events the system raises on its own (queue worker, scheduler). */
  actorId: string | null;
  payload?: Record<string, unknown>;
}

const PLAN = { select: { productionProjectId: true } } as const;
const PACKAGE = { select: { productionPlan: PLAN } } as const;

/**
 * Append-only production event log (PROJECT_OVERVIEW.md §4.1.4). Recording never
 * breaks the action it describes: a failed write is logged and dropped.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          actorType: entry.actorId ? 'USER' : 'SYSTEM',
          actorId: entry.actorId,
          productionProjectId: await this.projectIdOf(entry.entityType, entry.entityId),
          payload: entry.payload as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(`Could not record ${entry.action} for ${entry.entityType} ${entry.entityId}: ${String(error)}`);
    }
  }

  /** A project's events, newest first, with the name of whoever triggered each one. */
  async findForProject(projectId: string, limit = 100) {
    const events = await this.prisma.auditLog.findMany({
      where: { productionProjectId: projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const actorIds = [...new Set(events.map((e) => e.actorId).filter((id): id is string => id !== null))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true, role: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return events.map((event) => ({ ...event, actor: event.actorId ? (byId.get(event.actorId) ?? null) : null }));
  }

  private async projectIdOf(entityType: AuditEntity, id: string): Promise<string | null> {
    const db = this.prisma;
    switch (entityType) {
      case 'ProductionProject':
        return id;
      case 'ProductionPlan':
        return (await db.productionPlan.findUnique({ where: { id }, ...PLAN }))?.productionProjectId ?? null;
      case 'PlanReview':
        return (
          (await db.planReview.findUnique({ where: { id }, select: { productionPlan: PLAN } }))?.productionPlan
            .productionProjectId ?? null
        );
      case 'QuotaRequest':
        return (
          (await db.quotaRequest.findUnique({ where: { id }, select: { productionPlan: PLAN } }))?.productionPlan
            .productionProjectId ?? null
        );
      case 'GenerationJob':
        return (
          (await db.generationJob.findUnique({ where: { id }, select: { productionPlan: PLAN } }))?.productionPlan
            .productionProjectId ?? null
        );
      case 'EpisodePackage':
        return (
          (await db.episodePackage.findUnique({ where: { id }, ...PACKAGE }))?.productionPlan.productionProjectId ??
          null
        );
      case 'Review':
        return (
          (await db.review.findUnique({ where: { id }, select: { episodePackage: PACKAGE } }))?.episodePackage
            .productionPlan.productionProjectId ?? null
        );
      case 'Publication':
        return (
          (await db.publication.findUnique({ where: { id }, select: { episodePackage: PACKAGE } }))?.episodePackage
            .productionPlan.productionProjectId ?? null
        );
      case 'Episode':
        return (
          (
            await db.episode.findUnique({
              where: { id },
              select: { movie: { select: { productionProject: { select: { id: true } } } } },
            })
          )?.movie.productionProject?.id ?? null
        );
    }
  }
}
