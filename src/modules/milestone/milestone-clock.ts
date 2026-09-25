import { MilestoneStatus } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

interface TimedMilestone {
  id: string;
  status: MilestoneStatus;
  startDate: Date | null;
  targetDate: Date | null;
  createdAt: Date;
}

/** Milestones in the order they happen: by target date, undated ones last. */
export function byTimeline<T extends TimedMilestone>(milestones: T[]): T[] {
  return [...milestones].sort(
    (a, b) =>
      (a.targetDate?.getTime() ?? Infinity) - (b.targetDate?.getTime() ?? Infinity) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/**
 * A milestone's status follows the clock: PLANNED before it starts, IN_PROGRESS from its
 * start through its target day, COMPLETED once that day is over. It starts at its own
 * startDate, else where the previous milestone ended, else when production starts.
 * A CANCELLED milestone stays cancelled.
 */
export function statusAt(milestone: TimedMilestone, startsAt: Date | null, now: Date): MilestoneStatus {
  if (milestone.status === MilestoneStatus.CANCELLED) return MilestoneStatus.CANCELLED;
  if (milestone.targetDate && now.getTime() >= milestone.targetDate.getTime() + DAY_MS)
    return MilestoneStatus.COMPLETED;
  if (!startsAt || now >= startsAt) return MilestoneStatus.IN_PROGRESS;
  return MilestoneStatus.PLANNED;
}

/** Brings the stored status of a project's milestones in line with the clock. */
export async function syncMilestoneClock(prisma: PrismaService, projectId: string, now = new Date()) {
  const project = await prisma.productionProject.findUnique({
    where: { id: projectId },
    select: { productionStartDate: true, milestones: true },
  });
  if (!project) return;

  let previousEnd: Date | null = null;
  const changes: { id: string; status: MilestoneStatus; completedAt: Date | null }[] = [];
  for (const milestone of byTimeline(project.milestones)) {
    const startsAt = milestone.startDate ?? previousEnd ?? project.productionStartDate;
    const status = statusAt(milestone, startsAt, now);
    if (status !== milestone.status) {
      const completedAt =
        status === MilestoneStatus.COMPLETED ? new Date(milestone.targetDate!.getTime() + DAY_MS) : null;
      changes.push({ id: milestone.id, status, completedAt });
    }
    // The next milestone takes over the day after this one's target day.
    previousEnd = milestone.targetDate ? new Date(milestone.targetDate.getTime() + DAY_MS) : previousEnd;
  }

  if (changes.length > 0) {
    await prisma.$transaction(
      changes.map(({ id, status, completedAt }) =>
        prisma.milestone.update({ where: { id }, data: { status, completedAt } }),
      ),
    );
  }
}
