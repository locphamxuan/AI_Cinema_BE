import { BadRequestException, ConflictException } from '@nestjs/common';
import { MovieStatus, TokenEntryType, TokenRequestStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProductionFeeService } from 'src/modules/production/production-fee/production-fee.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { TokenRequestService } from './token-request.service';

const REVIEWER = { id: 'reviewer', role: 'CONTENT_REVIEWER' } as const;
const CREATOR = { id: 'creator', role: 'CONTENT_CREATOR' } as const;
const OPEN_REQUEST = {
  id: 'req',
  movieId: 'movie',
  seasonId: 'season',
  requestedById: CREATOR.id,
  requestedTokens: 4000n,
  reason: 'Studio tu choi',
  status: TokenRequestStatus.OPEN,
  movie: { title: 'Phim' },
  requestedBy: { fullName: 'Creator' },
};

describe('TokenRequestService', () => {
  const tokenRequest = {
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  const db = { tokenRequest, season: { findFirst: jest.fn() } };
  const prisma = {
    ...db,
    $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  const access = { movie: jest.fn() };
  const fees = { addEntry: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn().mockResolvedValue(['admin']) };
  const auditLog = { record: jest.fn() };
  const service = new TokenRequestService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    fees as unknown as ProductionFeeService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.adminIds.mockResolvedValue(['admin']);
  });

  it('lets a Creator ask once per season and tells the Reviewer and the Admin', async () => {
    access.movie.mockResolvedValue({
      id: 'movie',
      title: 'Phim',
      reviewerId: REVIEWER.id,
      status: MovieStatus.IN_PRODUCTION,
    });
    prisma.season.findFirst.mockResolvedValue({ id: 'season' });
    tokenRequest.count.mockResolvedValue(0);
    tokenRequest.create.mockResolvedValue({ id: 'req', requestedBy: { fullName: 'Creator' } });

    await service.create('movie', { seasonId: 'season', requestedTokens: 4000, reason: 'Studio tu choi' }, CREATOR);
    expect(notifications.notify).toHaveBeenCalledWith(
      [REVIEWER.id, 'admin'],
      expect.objectContaining({ type: 'TOKEN_REQUESTED' }),
      db,
    );

    tokenRequest.count.mockResolvedValue(1);
    await expect(
      service.create('movie', { seasonId: 'season', requestedTokens: 1, reason: 'again' }, CREATOR),
    ).rejects.toThrow(ConflictException);
  });

  it('books the granted Token as a top-up on the season and never more than asked', async () => {
    tokenRequest.findUnique.mockResolvedValue(OPEN_REQUEST);
    tokenRequest.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.approve('req', 5000, REVIEWER)).rejects.toThrow(BadRequestException);

    await service.approve('req', 3000, REVIEWER);
    expect(fees.addEntry).toHaveBeenCalledWith(
      'movie',
      expect.objectContaining({ entryType: TokenEntryType.TOP_UP, seasonId: 'season', amountTokens: 3000 }),
      REVIEWER,
    );
  });

  it('gives the request back to OPEN when the Reviewer lacks the budget', async () => {
    tokenRequest.findUnique.mockResolvedValue(OPEN_REQUEST);
    tokenRequest.updateMany.mockResolvedValue({ count: 1 });
    fees.addEntry.mockRejectedValueOnce(new ConflictException('Not enough Token'));

    await expect(service.approve('req', undefined, REVIEWER)).rejects.toThrow('Not enough Token');
    expect(tokenRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: TokenRequestStatus.OPEN }) }),
    );
  });

  it('shows a Creator only their own requests', async () => {
    tokenRequest.findMany.mockResolvedValue([]);
    tokenRequest.count.mockResolvedValue(0);
    await service.list({}, CREATOR);
    expect(tokenRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestedById: CREATOR.id } }),
    );
  });
});
