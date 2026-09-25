import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';

/** Read-only checks the project service runs before writing. */

export async function requireCreator(prisma: PrismaService, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new BadRequestException(`User with id "${userId}" does not exist`);
  }
  if (user.role !== UserRole.CONTENT_CREATOR) {
    throw new ForbiddenException(`User with id "${userId}" must have role CONTENT_CREATOR`);
  }
  return user;
}

export async function assertGenresExist(prisma: PrismaService, genreIds: string[]) {
  if (genreIds.length === 0) return;
  const count = await prisma.genre.count({ where: { id: { in: genreIds } } });
  if (count !== genreIds.length) {
    throw new BadRequestException('One or more genreIds do not exist');
  }
}

export async function assertPoliciesExist(prisma: PrismaService, policyIds: string[]) {
  if (policyIds.length === 0) return;
  const count = await prisma.policy.count({ where: { id: { in: policyIds } } });
  if (count !== policyIds.length) {
    throw new BadRequestException('One or more policyIds do not exist');
  }
}

export async function getTotalAllocated(prisma: PrismaService, projectId: string): Promise<number> {
  const aggregation = await prisma.quotaAllocation.aggregate({
    where: { productionProjectId: projectId },
    _sum: { allocatedAmount: true },
  });
  return Number(aggregation._sum.allocatedAmount ?? 0);
}

/** The longest episode the project's scenes already add up to. */
export async function getMaxPlanSceneDuration(prisma: PrismaService, projectId: string): Promise<number> {
  const plans = await prisma.productionPlan.findMany({
    where: { productionProjectId: projectId },
    include: { scenes: { select: { targetDurationSeconds: true } } },
  });
  let max = 0;
  for (const plan of plans) {
    const total = plan.scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
    if (total > max) max = total;
  }
  return max;
}
