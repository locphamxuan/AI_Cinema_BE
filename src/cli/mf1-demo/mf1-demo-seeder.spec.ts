import type { INestApplicationContext } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { AiLabelService } from 'src/modules/production/content-review/ai-label.service';
import { ComplianceService } from 'src/modules/production/content-review/compliance.service';
import { ContentReviewService } from 'src/modules/production/content-review/content-review.service';
import { StudioContractService } from 'src/modules/production/contract/contract-studio.service';
import { ContractService } from 'src/modules/production/contract/contract.service';
import { MovieProjectService } from 'src/modules/production/movie-project/movie-project.service';
import { ProjectNoteService } from 'src/modules/production/movie-project/project-note/project-note.service';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { FinalFilmService } from 'src/modules/production/publishing/final-film.service';
import { ScriptService } from 'src/modules/production/script/script.service';
import { StudioService } from 'src/modules/production/studio/studio.service';
import { StudioProfileService } from 'src/modules/production/studio-portal/profile/studio-profile.service';
import { removeMovie } from '../movie-removal';
import { loadDemoData } from './demo-data';
import { seedMf1Demo } from './mf1-demo-seeder';

jest.mock('../movie-removal', () => ({ removeMovie: jest.fn() }));

const USERS: Record<string, { id: string; role: string; studioId: string | null }> = {
  'admin@gmail.com': { id: 'admin', role: 'ADMIN', studioId: null },
  'reviewer@gmail.com': { id: 'rev', role: 'REVIEWER', studioId: null },
  'creator.aicinema@gmail.com': { id: 'cre', role: 'CONTENT_CREATOR', studioId: null },
  'studio@aicinema.com': { id: 'stu', role: 'STUDIO', studioId: 's1' },
};

function fakeApp() {
  let project = 0;
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(({ where }: { where: { email: string } }) => Promise.resolve(USERS[where.email])),
    },
    movie: { findMany: jest.fn().mockResolvedValue([{ id: 'old-movie' }]) },
    $transaction: jest.fn((work: (tx: unknown) => unknown) => work('tx')),
    contract: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'contract-1' }) },
    episode: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'ep-1' }), update: jest.fn() },
    mediaAsset: { create: jest.fn().mockResolvedValue({ id: 'asset-1' }) },
  };
  const services = new Map<unknown, Record<string, jest.Mock>>([
    [PrismaService, prisma as never],
    [PlatformSettingService, { update: jest.fn() }],
    [StudioService, { update: jest.fn() }],
    [StudioProfileService, { update: jest.fn() }],
    [MovieProjectService, { create: jest.fn(() => Promise.resolve({ id: `p${(project += 1)}` })) }],
    [ProductionCostService, { addEntry: jest.fn() }],
    [ProjectNoteService, { send: jest.fn() }],
    [ScriptService, { submit: jest.fn(), review: jest.fn(), finalReview: jest.fn() }],
    [StudioContractService, { propose: jest.fn() }],
    [ContractService, { sign: jest.fn() }],
    [ContentReviewService, { review: jest.fn() }],
    [AiLabelService, { apply: jest.fn() }],
    [ComplianceService, { run: jest.fn() }],
    [FinalFilmService, { confirm: jest.fn() }],
  ]);
  const app = { get: (token: unknown) => services.get(token) } as unknown as INestApplicationContext;
  const of = (token: unknown) => services.get(token)!;
  return { app, of, prisma };
}

describe('seedMf1Demo', () => {
  const demo = loadDemoData();

  it('sets both contract parties, then walks one project per milestone through the real services', async () => {
    const { app, of } = fakeApp();

    const done = await seedMf1Demo(app, demo);

    expect(done).toContain(`${demo.data.stages.length} projects`);
    expect(of(PlatformSettingService).update).toHaveBeenCalledWith(demo.data.platformParty, 'admin');
    expect(of(StudioService).update).toHaveBeenCalledWith(
      's1',
      demo.data.studioContact,
      expect.objectContaining({ id: 'admin' }),
    );
    // The studio fills in its own legal profile, as on Studio Web.
    expect(of(StudioProfileService).update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stu', role: 'STUDIO' }),
      demo.data.studioLegalProfile,
    );
    expect(removeMovie).toHaveBeenCalledWith('tx', 'old-movie');
    expect(of(MovieProjectService).create).toHaveBeenCalledTimes(demo.data.stages.length);
    // Every project carries its budget from the start; stage N stops at milestone N.
    expect(of(ProductionCostService).addEntry).toHaveBeenCalledTimes(demo.data.stages.length);
    expect(of(ScriptService).finalReview).toHaveBeenCalledTimes(demo.data.stages.length - 1);
    expect(of(StudioContractService).propose).toHaveBeenCalledTimes(demo.data.stages.length - 2);
    expect(of(ContractService).sign).toHaveBeenCalledTimes(demo.data.stages.length - 3);
    expect(of(FinalFilmService).confirm).toHaveBeenCalledTimes(demo.data.stages.length - 5);
  });

  it('signs with the demo signature images: the studio at the ceiling, then the Admin', async () => {
    const { app, of } = fakeApp();

    await seedMf1Demo(app, demo);

    const [contractId, cost, studio, upload] = of(StudioContractService).propose.mock.calls[0];
    expect([contractId, cost, studio]).toEqual(['contract-1', undefined, { studioId: 's1', userId: 'stu' }]);
    expect(upload).toMatchObject({ originalname: demo.data.signatures.studio, mimetype: 'image/png' });
    const [, admin, adminUpload] = of(ContractService).sign.mock.calls[0];
    expect(admin).toMatchObject({ id: 'admin' });
    expect(adminUpload).toMatchObject({ originalname: demo.data.signatures.admin, mimetype: 'image/png' });
  });

  it('asks for the base seed when the studio login is missing', async () => {
    const { app, prisma } = fakeApp();
    prisma.user.findUniqueOrThrow.mockImplementation(({ where }) =>
      Promise.resolve({ ...USERS[where.email], role: 'ADMIN', studioId: null }),
    );
    await expect(seedMf1Demo(app, demo)).rejects.toThrow(/prisma db seed/);
    prisma.user.findUniqueOrThrow.mockImplementation(({ where }) =>
      Promise.resolve({ ...USERS[where.email], studioId: null }),
    );
    await expect(seedMf1Demo(app, demo)).rejects.toThrow(/prisma db seed/);
  });
});
