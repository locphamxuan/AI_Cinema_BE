import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractProposedBy, ContractStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { assertContractStatus, lockedContract, openNextRound, type Detailed } from './contract-rounds';

const CONTRACT = {
  id: 'c1',
  projectId: 'p1',
  studioId: 's1',
  round: 2,
  terms: 'Điều khoản',
  createdById: 'admin',
  handoffId: 'h2',
  status: ContractStatus.SENT,
} as Detailed;

describe('contract-rounds', () => {
  const db = {
    $queryRaw: jest.fn(),
    contract: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  const tx = db as unknown as PrismaTx;

  beforeEach(() => {
    jest.clearAllMocks();
    db.contract.findUnique.mockResolvedValue({ id: 'c1', studioId: 's1' });
    db.contract.findUniqueOrThrow.mockResolvedValue(CONTRACT);
    db.contract.create.mockResolvedValue({ id: 'c2' });
  });

  it('takes the row lock before reading the contract', async () => {
    await expect(lockedContract(tx, 'c1', 's1')).resolves.toBe(CONTRACT);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.contract.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it("answers 404 for an unknown contract and another studio's, without locking", async () => {
    await expect(lockedContract(tx, 'c1', 'other')).rejects.toBeInstanceOf(NotFoundException);
    db.contract.findUnique.mockResolvedValue(null);
    await expect(lockedContract(tx, 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses a round in another status', () => {
    expect(() => assertContractStatus(CONTRACT, ContractStatus.SENT, 'sign')).not.toThrow();
    expect(() => assertContractStatus(CONTRACT, ContractStatus.STUDIO_SIGNED, 'sign')).toThrow(ConflictException);
  });

  it('supersedes the round and opens the next one with the same terms and waiting hand-off', async () => {
    await expect(openNextRound(tx, CONTRACT, { costVnd: 5n, proposedBy: ContractProposedBy.STUDIO })).resolves.toEqual({
      id: 'c2',
    });
    expect(db.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContractStatus.SUPERSEDED },
    });
    expect(db.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: 'p1',
          studioId: 's1',
          handoffId: 'h2',
          round: 3,
          previousId: 'c1',
          terms: 'Điều khoản',
          createdById: 'admin',
          costVnd: 5n,
          proposedBy: ContractProposedBy.STUDIO,
        },
      }),
    );
  });
});
