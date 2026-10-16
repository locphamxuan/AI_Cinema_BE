import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ProductionFeeService } from './production-fee.service';

/** What a new brief may promise once replaced studios took their fee (BR-59). */
describe('ProductionFeeService.spendableTokens', () => {
  const prisma = {
    tokenLedgerEntry: { aggregate: jest.fn(), count: jest.fn() },
    studioHandoff: { aggregate: jest.fn() },
  };
  const service = new ProductionFeeService(prisma as unknown as PrismaService, null!, null!, null!, null!);

  /** Ledger and loss sums: whole project first, then the season when one is asked. */
  const given = (project: number, projectLost: number, season?: number, seasonLost?: number, wholeProject = 0) => {
    prisma.tokenLedgerEntry.count.mockReset().mockResolvedValue(wholeProject);
    prisma.tokenLedgerEntry.aggregate.mockReset().mockResolvedValueOnce({ _sum: { amountTokens: BigInt(project) } });
    prisma.studioHandoff.aggregate.mockReset().mockResolvedValueOnce({ _sum: { lostTokens: BigInt(projectLost) } });
    if (season !== undefined) {
      prisma.tokenLedgerEntry.aggregate.mockResolvedValueOnce({ _sum: { amountTokens: BigInt(season) } });
      prisma.studioHandoff.aggregate.mockResolvedValueOnce({ _sum: { lostTokens: BigInt(seasonLost ?? 0) } });
    }
  };

  it('leaves the whole project fee when no studio was replaced', async () => {
    given(900_000, 0);
    await expect(service.spendableTokens('m1', null)).resolves.toBe(900_000);
  });

  it('takes what replaced studios cost off the season', async () => {
    given(900_000, 500_000, 500_000, 500_000);
    await expect(service.spendableTokens('m1', 's1')).resolves.toBe(0);
  });

  it('counts the hand-offs about to be replaced by this brief', async () => {
    given(900_000, 0, 500_000, 0);
    await expect(service.spendableTokens('m1', 's1', 500_000)).resolves.toBe(0);
  });

  it('gives the season a top-up made after the swap', async () => {
    given(1_300_000, 500_000, 900_000, 500_000);
    await expect(service.spendableTokens('m1', 's1')).resolves.toBe(400_000);
  });

  it('never promises more than the project has left', async () => {
    given(600_000, 400_000, 500_000, 0);
    await expect(service.spendableTokens('m1', 's1')).resolves.toBe(200_000);
  });

  it('falls back on the project fee for a project funded before its seasons were priced', async () => {
    given(700_000, 0, 0, 0, 1);
    await expect(service.spendableTokens('m1', 's1')).resolves.toBe(700_000);
  });

  it('gives a season nobody funded nothing, even when other seasons are funded', async () => {
    given(700_000, 0, 0, 0, 0);
    await expect(service.spendableTokens('m1', 's2')).resolves.toBe(0);
  });
});
