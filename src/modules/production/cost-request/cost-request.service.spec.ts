import { Readable } from 'node:stream';
import { BadRequestException, ConflictException, NotFoundException, StreamableFile } from '@nestjs/common';
import { CostRequestStatus, ProjectStatus, StudioMilestoneStatus } from '@prisma/client';
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
    findMany: jest.fn(),
  };
  const db = { productionCostRequest, studioHandoff: { findFirst: jest.fn() } };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn(), readableWhere: jest.fn() };
  const costs = { lock: jest.fn(), grant: jest.fn() };
  const storage = { putBuffer: jest.fn(), remove: jest.fn().mockResolvedValue(undefined), stream: jest.fn() };
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

  it('removes the stored proof when the transaction fails, whether or not the removal works', async () => {
    productionCostRequest.count.mockResolvedValue(1);
    storage.remove.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.create('p1', ask, PDF, REVIEWER)).rejects.toThrow(ConflictException);
    const [key] = storage.putBuffer.mock.calls[0] as [string];
    expect(key).toMatch(/^movies\/p1\/cost-requests\/.+\.pdf$/);
    expect(storage.remove).toHaveBeenCalledWith(key, 'private');
  });

  it('checks the hand-off belongs to the project and is still live', async () => {
    const withHandoff = { ...ask, handoffId: 'h1' };
    db.studioHandoff.findFirst.mockResolvedValue(null);
    await expect(service.create('p1', withHandoff, PDF, REVIEWER)).rejects.toThrow(BadRequestException);
    db.studioHandoff.findFirst.mockResolvedValue({ milestoneStatus: StudioMilestoneStatus.SUPERSEDED });
    await expect(service.create('p1', withHandoff, PDF, REVIEWER)).rejects.toThrow(ConflictException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  describe('list', () => {
    beforeEach(() => {
      productionCostRequest.findMany.mockResolvedValue([{ id: 'req' }]);
      productionCostRequest.count.mockResolvedValue(21);
    });

    it("reads one project's requests after checking access", async () => {
      await expect(service.list({ page: 2, limit: 10 }, REVIEWER, 'p1')).resolves.toEqual({
        data: [{ id: 'req' }],
        meta: { page: 2, limit: 10, total: 21, totalPages: 3 },
      });
      expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'read');
      expect(productionCostRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'p1' }, skip: 10, take: 10 }),
      );
    });

    it('scopes the inbox to the readable projects and filters by status, 20 a page by default', async () => {
      access.readableWhere.mockResolvedValue({ reviewerId: REVIEWER.id });
      productionCostRequest.count.mockResolvedValue(0);
      await expect(service.list({ status: CostRequestStatus.OPEN }, REVIEWER)).resolves.toMatchObject({
        meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });
      expect(productionCostRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { project: { reviewerId: REVIEWER.id }, status: CostRequestStatus.OPEN },
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('proof', () => {
    it('streams the quote to someone who can read the project', async () => {
      productionCostRequest.findUnique.mockResolvedValue({
        projectId: 'p1',
        attachmentKey: 'k',
        attachmentMimeType: 'application/pdf',
        attachmentName: 'báo giá.pdf',
      });
      storage.stream.mockResolvedValue(Readable.from('x'));
      const file = await service.proof('req', REVIEWER);
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders()).toMatchObject({
        type: 'application/pdf',
        disposition: `attachment; filename*=UTF-8''${encodeURIComponent('báo giá.pdf')}`,
      });
      expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'read');
    });

    it('answers 404 for an unknown request and one without a file', async () => {
      productionCostRequest.findUnique.mockResolvedValue(null);
      await expect(service.proof('x', REVIEWER)).rejects.toThrow(NotFoundException);
      productionCostRequest.findUnique.mockResolvedValue({ projectId: 'p1', attachmentKey: null });
      await expect(service.proof('req', REVIEWER)).rejects.toThrow(NotFoundException);
    });
  });

  it('grants the full amount when the Admin names none', async () => {
    await service.approve('req', undefined, undefined, ADMIN);
    expect(productionCostRequest.update).toHaveBeenCalledWith({
      where: { id: 'req' },
      data: expect.objectContaining({ grantedVnd: 20_000_000n, adminResponse: null }) as unknown,
    });
  });

  it('rejects with the reason and tells the requester', async () => {
    await service.reject('req', ' Không đủ ngân sách ', ADMIN);
    expect(productionCostRequest.update).toHaveBeenCalledWith({
      where: { id: 'req' },
      data: expect.objectContaining({ status: 'REJECTED', adminResponse: 'Không đủ ngân sách' }) as unknown,
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      [REVIEWER.id],
      expect.objectContaining({ type: 'COST_REQUEST_REJECTED' }),
      db,
    );
    expect(costs.grant).not.toHaveBeenCalled();
  });

  it('answers 404 before locking when the request does not exist', async () => {
    productionCostRequest.findUnique.mockResolvedValue(null);
    await expect(service.reject('x', 'no', ADMIN)).rejects.toThrow(NotFoundException);
    expect(costs.lock).not.toHaveBeenCalled();
  });
});
