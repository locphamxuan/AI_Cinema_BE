import { ConflictException } from '@nestjs/common';
import { GenerationJobStatus, GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerationJobService } from 'src/modules/generation-job/generation-job.service';
import { EpisodeSubtitleService, type EpisodeScene } from './episode-subtitle.service';

const SCENES: EpisodeScene[] = [
  { id: 'scene-1', title: 'Hẻm mưa', description: null, scriptText: 'Mưa rơi.', durationSeconds: 8 },
  { id: 'scene-2', title: 'Sân thượng', description: 'Gió lớn', scriptText: null, durationSeconds: 4 },
];

const completedJob = (sceneId: string, language: string, text: string, overrides: object = {}) => ({
  id: `${sceneId}-${language}`,
  parentJobId: null,
  sceneId,
  language,
  status: GenerationJobStatus.COMPLETED,
  errorMessage: null,
  generatedAssets: [{ contentText: text }],
  ...overrides,
});

describe('EpisodeSubtitleService', () => {
  const prisma = { generationJob: { findMany: jest.fn() } };
  const generationJobs = { create: jest.fn(), runNow: jest.fn() };
  const service = new EpisodeSubtitleService(
    prisma as unknown as PrismaService,
    generationJobs as unknown as GenerationJobService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    generationJobs.create.mockImplementation((_plan: string, dto: { sceneId: string; language: string }) =>
      Promise.resolve({ id: `${dto.sceneId}-${dto.language}` }),
    );
    generationJobs.runNow.mockImplementation((id: string) => Promise.resolve(completedJob('x', 'x', `new ${id}`)));
  });

  it('reuses lines already generated and generates only the missing ones', async () => {
    prisma.generationJob.findMany.mockResolvedValue([
      completedJob('scene-1', 'vi', 'Mưa rơi.'),
      completedJob('scene-2', 'vi', 'Gió lớn.'),
    ]);

    const tracks = await service.buildTracks('plan-id', SCENES, ['vi', 'en'], 'creator-id');

    expect(tracks.map((t) => t.language)).toEqual(['vi', 'en']);
    expect(tracks[0].content).toContain('00:00:08.000 --> 00:00:12.000\nGió lớn.');
    expect(generationJobs.create.mock.calls).toEqual([
      [
        'plan-id',
        { jobType: GenerationJobType.TRANSLATION, language: 'en', sceneId: 'scene-1', prompt: 'Mưa rơi.' },
        'creator-id',
      ],
      [
        'plan-id',
        { jobType: GenerationJobType.TRANSLATION, language: 'en', sceneId: 'scene-2', prompt: 'Gió lớn' },
        'creator-id',
      ],
    ]);
    expect(tracks[1].content).toContain('new scene-2-en');
  });

  it('ignores a line whose latest attempt did not complete', async () => {
    prisma.generationJob.findMany.mockResolvedValue([
      completedJob('scene-1', 'vi', 'Cũ'),
      completedJob('scene-1', 'vi', '', { id: 'retry', parentJobId: 'scene-1-vi', status: GenerationJobStatus.FAILED }),
    ]);

    await service.buildTracks('plan-id', SCENES.slice(0, 1), ['vi'], 'creator-id');

    expect(generationJobs.create).toHaveBeenCalledWith(
      'plan-id',
      expect.objectContaining({ jobType: GenerationJobType.SUBTITLE, language: 'vi' }),
      'creator-id',
    );
  });

  it('fails the assembly when a line cannot be generated', async () => {
    prisma.generationJob.findMany.mockResolvedValue([]);
    generationJobs.runNow.mockResolvedValue(
      completedJob('scene-1', 'vi', '', { status: GenerationJobStatus.FAILED, errorMessage: 'provider down' }),
    );

    await expect(service.buildTracks('plan-id', SCENES, ['vi'], 'creator-id')).rejects.toThrow(
      new ConflictException('Could not generate "vi" subtitles for scene "Hẻm mưa": provider down'),
    );
  });
});
