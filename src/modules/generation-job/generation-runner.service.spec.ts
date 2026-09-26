import { AiUsageEntryType, GenerationJobStatus, GenerationJobType, QuotaAllocationStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { GenerationRunner } from './generation-runner.service';
import type { AiGenerationProvider } from './ai-generation-provider';

const ALLOCATION = { id: 'alloc-id', remainingAmount: 100, status: QuotaAllocationStatus.ACTIVE };

describe('GenerationRunner', () => {
  const tx = {
    generatedAsset: { create: jest.fn() },
    aiUsageLedger: { createMany: jest.fn() },
    quotaAllocation: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    generationJob: { update: jest.fn() },
  };
  const prisma = {
    generationJob: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const generate = jest.fn();
  const aiProvider: AiGenerationProvider = { name: 'test', generate };
  const record = jest.fn();
  const runner = new GenerationRunner(prisma as unknown as PrismaService, aiProvider, {
    record,
  } as unknown as AuditLogService);

  beforeEach(() => jest.clearAllMocks());

  const queuedJob = {
    id: 'job-id',
    productionPlanId: 'plan-id',
    jobType: GenerationJobType.SCENE_VIDEO,
    status: GenerationJobStatus.QUEUED,
    customFunction: null,
    rawPrompt: 'rượt đuổi',
    genreStyleModelId: null,
    configSnapshot: null,
    quotaAllocationId: 'alloc-id',
    prompt: { composedPrompt: 'Direction: rượt đuổi', composeTokenCost: 2, seed: 7 },
  };

  beforeEach(() => {
    prisma.generationJob.findUnique.mockResolvedValue(queuedJob);
    tx.quotaAllocation.findUnique.mockResolvedValue(ALLOCATION);
    tx.generationJob.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ ...queuedJob, ...data }),
    );
  });

  it('stores the output, books generation and composer cost in the ledger and charges the quota', async () => {
    generate.mockResolvedValue({ outputUnits: 18, storageKey: 'video.m3u8' });
    tx.quotaAllocation.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const job = await runner.execute('job-id');

    expect(tx.aiUsageLedger.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entryType: AiUsageEntryType.GENERATION,
          tokenCost: 108,
          outputDurationSeconds: 18,
        }),
        expect.objectContaining({ entryType: AiUsageEntryType.PROMPT_COMPOSE, tokenCost: 2 }),
      ],
    });
    expect(tx.quotaAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: 'alloc-id', remainingAmount: { gte: 110 } },
      data: { remainingAmount: { decrement: 110 } },
    });
    expect(job).toMatchObject({ status: GenerationJobStatus.COMPLETED, resourceCost: 110 });
  });

  it('keeps an overrun visible: full cost in the ledger, allocation closed at zero', async () => {
    generate.mockResolvedValue({ outputUnits: 40 });
    tx.quotaAllocation.updateMany.mockResolvedValue({ count: 0 });

    const job = await runner.execute('job-id');

    expect(tx.quotaAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-id' },
      data: { remainingAmount: 0, status: QuotaAllocationStatus.CONSUMED },
    });
    expect(job).toMatchObject({ resourceCost: 242 });
  });

  it('marks the job FAILED when the provider errors, without charging anything', async () => {
    generate.mockRejectedValue(new Error('provider down'));
    prisma.generationJob.update.mockImplementation(({ data }: { data: object }) => Promise.resolve(data));

    const job = await runner.execute('job-id');

    expect(job).toMatchObject({ status: GenerationJobStatus.FAILED, errorMessage: 'provider down' });
    expect(tx.aiUsageLedger.createMany).not.toHaveBeenCalled();
  });

  it('leaves a job alone once it was cancelled while waiting in the queue', async () => {
    prisma.generationJob.findUnique.mockResolvedValue({ ...queuedJob, status: GenerationJobStatus.CANCELLED });

    await runner.execute('job-id');

    expect(generate).not.toHaveBeenCalled();
    expect(prisma.generationJob.update).not.toHaveBeenCalled();
  });

  it('records the outcome as a production event', async () => {
    generate.mockResolvedValue({ outputUnits: 18 });
    tx.quotaAllocation.updateMany.mockResolvedValue({ count: 1 });

    await runner.execute('job-id');

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GENERATION_COMPLETED', entityType: 'GenerationJob', entityId: 'job-id' }),
    );
  });
});
