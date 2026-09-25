import { MilestoneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { statusAt, syncMilestoneClock } from './milestone-clock';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const milestone = (id: string, targetDate: string | null, overrides: object = {}) => ({
  id,
  status: MilestoneStatus.PLANNED,
  startDate: null,
  targetDate: targetDate ? day(targetDate) : null,
  createdAt: day('2026-09-01'),
  ...overrides,
});

describe('milestone clock', () => {
  it.each([
    ['before it starts', '2026-10-04', MilestoneStatus.PLANNED],
    ['from its start', '2026-10-05', MilestoneStatus.IN_PROGRESS],
    ['through its target day', '2026-10-10', MilestoneStatus.IN_PROGRESS],
    ['once the target day is over', '2026-10-11', MilestoneStatus.COMPLETED],
  ])('reads the status %s', (_, now, status) => {
    expect(statusAt(milestone('m', '2026-10-10'), day('2026-10-05'), day(now))).toBe(status);
  });

  it('keeps a cancelled milestone cancelled', () => {
    const cancelled = milestone('m', '2026-10-10', { status: MilestoneStatus.CANCELLED });
    expect(statusAt(cancelled, null, day('2026-12-01'))).toBe(MilestoneStatus.CANCELLED);
  });

  it('starts each milestone the day after the previous one and stores what changed', async () => {
    const update = jest.fn((args: object) => args);
    const prisma = {
      productionProject: {
        findUnique: jest.fn().mockResolvedValue({
          productionStartDate: day('2026-10-01'),
          milestones: [
            milestone('script', '2026-10-10', { status: MilestoneStatus.IN_PROGRESS }),
            milestone('shoot', '2026-10-20'),
            milestone('edit', '2026-10-30'),
          ],
        }),
      },
      milestone: { update },
      $transaction: jest.fn(),
    };

    await syncMilestoneClock(prisma as unknown as PrismaService, 'p1', day('2026-10-12'));

    expect(update.mock.calls.map(([args]) => args)).toEqual([
      { where: { id: 'script' }, data: { status: MilestoneStatus.COMPLETED, completedAt: day('2026-10-11') } },
      { where: { id: 'shoot' }, data: { status: MilestoneStatus.IN_PROGRESS, completedAt: null } },
    ]);
  });
});
