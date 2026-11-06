import { BadRequestException, ConflictException } from '@nestjs/common';
import { CostRequestStatus, ProjectStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { CostRequestService } from './cost-request.service';

const REVIEWER = { id: 'reviewer', role: 'CONTENT_REVIEWER' } as const;
const ADMIN = { id: 'admin', role: 'ADMIN' } as const;
const PDF = {
  originalname: 'bao-gia.pdf',
  size: 9,
  buffer: Buffer.from('%PDF-1.4\n'),
} as Express.Multer.File;
const OPEN_REQUEST = {
  id: 'req',
  projectId: 'p1',
  requestedById: REVIEWER.id,
  requestedVnd: 20_000_000n,
  reason: 'Studio báo giá 170 triệu',
  status: CostRequestStatus.OPEN,
  project: { id: 'p1', reviewerId: REVIEWER.id, creatorId: null, movie: { title: 'Phim' } },
};

describe('CostRequestService', () => {
  const productionCostRequest = {
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const db = { productionCostRequest, studioHandoff: { findFirst: jest.fn() } };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const costs = { lock: jest.fn(), grant: jest.fn() };
  const storage = { putBuffer: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn(), adminIds: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new CostRequestService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    costs as unknown as ProductionCostService,
    storage as unknown as ObjectStorage,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );
  const ask = { requestedVnd: 20_000_000, studioQuoteVnd: 170_000_000, reason: 'Studio báo giá 170 triệu' };

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.adminIds.mockResolvedValue(['admin']);
    access.project.mockResolvedValue({ id: 'p1', status: ProjectStatus.IN_PRODUCTION, movie: { title: 'Phim' } });
    productionCostRequest.findUnique.mockResolvedValue({ projectId: 'p1' });
    productionCostRequest.findUniqueOrThrow.mockResolvedValue(OPEN_REQUEST);
  });

  it('lets the Reviewer ask once per project, with proof, and tells the Admin', async () => {
    productionCostRequest.count.mockResolvedValue(0);
    productionCostRequest.create.mockResolvedValue({ id: 'req' });

    await service.create('p1', ask, PDF, REVIEWER);

    expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'reviewer');
    expect(costs.lock).toHaveBeenCalledWith(db, 'p1');
    expect(notifications.notify).toHaveBeenCalledWith(
      ['admin'],
      expect.objectContaining({ type: 'COST_REQUESTED' }),
      db,
    );

    productionCostRequest.count.mockResolvedValue(1);
    await expect(service.create('p1', ask, PDF, REVIEWER)).rejects.toThrow(ConflictException);
    expect(storage.remove).toHaveBeenCalled();
  });

  it('refuses a request without proof', async () => {
    await expect(service.create('p1', ask, undefined, REVIEWER)).rejects.toThrow(BadRequestException);
  });

  it('grants less than asked, booked in the same transaction', async () => {
    await service.approve('req', 15_000_000, 'Cắt bớt cảnh phụ', ADMIN);

    expect(productionCostRequest.update).toHaveBeenCalledWith({
      where: { id: 'req' },
      data: expect.objectContaining({ status: 'APPROVED', grantedVnd: 15_000_000n, resolvedById: 'admin' }) as unknown,
    });
    expect(costs.grant).toHaveBeenCalledWith(db, OPEN_REQUEST, 15_000_000, expect.any(String), 'admin');
  });

  it('never grants more than asked nor answers twice', async () => {
    await expect(service.approve('req', 25_000_000, undefined, ADMIN)).rejects.toThrow(BadRequestException);
    productionCostRequest.findUniqueOrThrow.mockResolvedValue({ ...OPEN_REQUEST, status: CostRequestStatus.REJECTED });
    await expect(service.reject('req', 'Không đủ ngân sách', ADMIN)).rejects.toThrow(ConflictException);
    expect(costs.grant).not.toHaveBeenCalled();
  });
});
