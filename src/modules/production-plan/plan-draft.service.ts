import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertProjectOpen } from 'src/modules/production-project/project-lifecycle';
import { DraftSceneDto, SavePlanDraftRequestDto } from './dto/save-plan-draft.request.dto';

// The database may sit a long round-trip away; Prisma's defaults (2s to start, 5s to finish) are too tight.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };
const EDITABLE: ProductionPlanStatus[] = [ProductionPlanStatus.DRAFT, ProductionPlanStatus.CHANGES_REQUESTED];

/**
 * Saves a whole plan draft — script, proposed duration, estimate and every scene — in a
 * fixed handful of queries, however many scenes it has. Saving one scene per request cost
 * several database round-trips each, which made saving and submitting a plan slow.
 * A draft may be incomplete or too long; the rules are checked when the plan is submitted.
 */
@Injectable()
export class PlanDraftService {
  constructor(private readonly prisma: PrismaService) {}

  async save(planId: string, dto: SavePlanDraftRequestDto) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      select: {
        status: true,
        scenes: { select: { id: true } },
        productionProject: { select: { status: true } },
      },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    assertProjectOpen(plan.productionProject);
    if (!EDITABLE.includes(plan.status)) {
      throw new ConflictException(
        `Only a DRAFT or CHANGES_REQUESTED plan can be edited, current status "${plan.status}"`,
      );
    }

    const existingIds = new Set(plan.scenes.map((s) => s.id));
    const foreign = dto.scenes.filter((s) => s.id && !existingIds.has(s.id));
    if (foreign.length)
      throw new BadRequestException(`Scenes ${foreign.map((s) => s.id).join(', ')} are not in this plan`);
    const numbers = dto.scenes.map((s) => s.sceneNumber);
    if (new Set(numbers).size !== numbers.length) throw new BadRequestException('Scene numbers must be unique');

    const kept = dto.scenes.filter((s): s is DraftSceneDto & { id: string } => Boolean(s.id));
    const added = dto.scenes.filter((s) => !s.id);
    const keptIds = new Set(kept.map((s) => s.id));
    const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

    await this.prisma.$transaction(async (tx) => {
      if (removedIds.length) await tx.scene.deleteMany({ where: { id: { in: removedIds } } });
      if (kept.length) {
        // Park the kept scenes on negative numbers first, so renumbering and new scenes never
        // collide with the (plan, scene number) unique key halfway through.
        await tx.$executeRaw`UPDATE "scenes" SET "scene_number" = -"scene_number" WHERE "id" IN (${Prisma.join(kept.map((s) => Prisma.sql`${s.id}::uuid`))})`;
      }
      if (added.length) {
        await tx.scene.createMany({
          data: added.map((s) => ({
            productionPlanId: planId,
            sceneNumber: s.sceneNumber,
            title: s.title,
            description: s.description,
            scriptText: s.description,
            targetDurationSeconds: s.targetDurationSeconds,
            estimatedTokens: s.estimatedTokens ?? 0,
          })),
        });
      }
      if (kept.length) {
        const rows = kept.map(
          (s) =>
            Prisma.sql`(${s.id}::uuid, ${s.sceneNumber}::int, ${s.title}, ${s.description ?? null}, ${s.targetDurationSeconds}::int, ${s.estimatedTokens ?? 0}::int)`,
        );
        await tx.$executeRaw`
          UPDATE "scenes" AS s SET
            "scene_number" = v.scene_number,
            "title" = v.title,
            "description" = v.description,
            "script_text" = v.description,
            "target_duration_seconds" = v.seconds,
            "estimated_tokens" = v.tokens,
            "updated_at" = NOW()
          FROM (VALUES ${Prisma.join(rows)}) AS v(id, scene_number, title, description, seconds, tokens)
          WHERE s."id" = v.id`;
      }
      await tx.productionPlan.update({
        where: { id: planId },
        data: {
          scriptText: dto.scriptText,
          targetDurationSeconds: dto.targetDurationSeconds,
          estimatedAiResourceUsage: dto.estimatedAiResourceUsage,
          totalSceneCount: dto.scenes.length,
        },
      });
    }, TRANSACTION_OPTIONS);

    return this.prisma.scene.findMany({
      where: { productionPlanId: planId },
      orderBy: { sceneNumber: 'asc' },
      select: {
        id: true,
        sceneNumber: true,
        title: true,
        description: true,
        targetDurationSeconds: true,
        estimatedTokens: true,
      },
    });
  }
}
