import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { EpisodeStatus, MovieStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { MediaIngestService } from './media-ingest.service';
import type { MediaOutcomeService } from './pipeline/media-outcome.service';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
const USER = { id: 'creator', role: 'CONTENT_CREATOR' } as never;

describe('MediaIngestService.submitUpload', () => {
  it('deletes the stored file when its version cannot be created', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ingest-spec-'));
    const path = join(dir, 'upload');
    await writeFile(path, MP4);
    const storage = { putFile: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) };
    const access = {
      episode: jest.fn().mockResolvedValue({
        status: EpisodeStatus.AWAITING_MEDIA,
        movie: { status: MovieStatus.IN_PRODUCTION },
      }),
    };
    const prisma = { $transaction: jest.fn().mockRejectedValue(new ConflictException('The episode changed')) };
    const service = new MediaIngestService(
      prisma as unknown as PrismaService,
      access as unknown as ProjectAccessService,
      storage as unknown as ObjectStorage,
      {} as JobQueue,
      {} as AuditLogService,
      {} as MediaOutcomeService,
      {} as AppConfig,
    );
    const file = { path, originalname: 'tap.mp4', size: MP4.length } as Express.Multer.File;

    await expect(
      service.submitUpload('episode', file, { proposedLabelType: 'AI_GENERATED' } as never, {} as never, {
        user: USER,
      }),
    ).rejects.toThrow('The episode changed');

    const [storedKey] = storage.putFile.mock.calls[0] as [string];
    expect(storage.remove).toHaveBeenCalledWith(storedKey, 'private');
  });
});
