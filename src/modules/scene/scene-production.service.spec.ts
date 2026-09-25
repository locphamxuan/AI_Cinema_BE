import { GenerationJobStatus, GenerationJobType, ProductionPlanStatus, SceneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { GeminiTextClient } from 'src/modules/generation-job/providers/gemini-text';
import { SceneService } from './scene.service';
import { SceneAdvisorService } from './scene-advisor.service';

const SCENE = {
  id: 'scene-2',
  productionPlanId: 'plan-id',
  sceneNumber: 2,
  title: 'Chợ quê',
  description: 'Buổi sáng ở chợ quê',
  scriptText: 'Bà Tư: "Mua rau đi con!"',
  status: SceneStatus.COMPLETED,
  productionPlan: {
    productionProjectId: 'project-id',
    productionProject: { title: 'Làng tôi', description: 'Một ngày ở làng quê', primaryGenre: { name: 'Drama' } },
  },
};

describe('Scene production (Studio)', () => {
  const tx = {
    generationJob: { updateMany: jest.fn() },
    productionPlan: { updateMany: jest.fn() },
    scene: { update: jest.fn() },
  };
  const prisma = {
    scene: { findUnique: jest.fn(), update: jest.fn() },
    productionPlan: { findUnique: jest.fn() },
    submission: { findFirst: jest.fn() },
    generationJob: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new SceneService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.scene.findUnique.mockResolvedValue(SCENE);
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      status: ProductionPlanStatus.APPROVED,
      productionProject: { status: 'ACTIVE' },
    });
    prisma.submission.findFirst.mockResolvedValue(null);
  });

  describe('updateDirection', () => {
    it('retitles and redescribes a scene of an approved plan', async () => {
      await service.updateDirection('scene-2', { title: ' Chợ sớm ', description: 'Sương sớm phủ chợ' });

      expect(prisma.scene.update).toHaveBeenCalledWith({
        where: { id: 'scene-2' },
        data: { title: 'Chợ sớm', description: 'Sương sớm phủ chợ' },
      });
    });

    it('refuses while the cut is with the Reviewer', async () => {
      prisma.submission.findFirst.mockResolvedValue({ status: 'UNDER_REVIEW' });

      await expect(service.updateDirection('scene-2', { title: 'x' })).rejects.toThrow('can no longer be changed');
      expect(prisma.scene.update).not.toHaveBeenCalled();
    });

    it('refuses before the plan is approved', async () => {
      prisma.productionPlan.findUnique.mockResolvedValue({
        id: 'plan-id',
        status: ProductionPlanStatus.DRAFT,
        productionProject: { status: 'ACTIVE' },
      });

      await expect(service.updateDirection('scene-2', { title: 'x' })).rejects.toThrow('APPROVED');
    });
  });

  describe('reset', () => {
    it('cancels every generation and reopens a finished scene', async () => {
      prisma.generationJob.findMany.mockResolvedValue([
        { id: 'job-1', status: GenerationJobStatus.COMPLETED },
        { id: 'job-2', status: GenerationJobStatus.FAILED },
      ]);

      await service.reset('scene-2');

      expect(tx.generationJob.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['job-1', 'job-2'] } },
        data: { status: GenerationJobStatus.CANCELLED },
      });
      expect(tx.productionPlan.updateMany).toHaveBeenCalledWith({
        where: { id: 'plan-id', completedSceneCount: { gt: 0 } },
        data: { completedSceneCount: { decrement: 1 } },
      });
      expect(tx.scene.update).toHaveBeenCalledWith({
        where: { id: 'scene-2' },
        data: { status: SceneStatus.APPROVED },
      });
    });

    it('waits for a running generation', async () => {
      prisma.generationJob.findMany.mockResolvedValue([{ id: 'job-1', status: GenerationJobStatus.RUNNING }]);

      await expect(service.reset('scene-2')).rejects.toThrow('still running');
      expect(tx.generationJob.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('SceneAdvisorService', () => {
    const job = (
      jobType: GenerationJobType,
      rawPrompt: string,
      status: GenerationJobStatus = GenerationJobStatus.COMPLETED,
    ) => ({ id: `${jobType}-${rawPrompt}`, parentJobId: null, jobType, rawPrompt, status });
    const scene = (
      sceneNumber: number,
      title: string,
      generationJobs: ReturnType<typeof job>[],
      extra: object = {},
    ) => ({
      id: `scene-${sceneNumber}`,
      sceneNumber,
      title,
      description: null,
      scriptText: null,
      generationJobs,
      ...extra,
    });
    const givenPlan = (scenes: ReturnType<typeof scene>[]) =>
      prisma.productionPlan.findUnique.mockResolvedValue({
        id: 'plan-id',
        productionProject: SCENE.productionPlan.productionProject,
        scenes,
      });
    const advisor = (gemini: Partial<GeminiTextClient>) =>
      new SceneAdvisorService(prisma as unknown as PrismaService, gemini as GeminiTextClient);
    const offline = { isAvailable: false };
    const gate = scene(1, 'Cổng làng', [job(GenerationJobType.SCENE_VIDEO, 'cổng làng lúc bình minh, toàn cảnh')]);
    const market = (jobs: ReturnType<typeof job>[]) =>
      scene(2, 'Chợ quê', jobs, { description: SCENE.description, scriptText: SCENE.scriptText });

    it('finds what the scene lacks and suggests it, linked to the previous scene', async () => {
      givenPlan([gate, market([])]);

      const advice = await advisor(offline).advise('scene-2');

      expect(advice.gaps.map((g) => g.aspect)).toEqual(['video', 'voice', 'audio']);
      expect(advice.previousScene).toEqual({ number: 1, title: 'Cổng làng' });
      expect(advice.nextScene).toBeNull();
      expect(advice.suggestions.map((s) => s.jobType)).toEqual([
        GenerationJobType.SCENE_VIDEO,
        GenerationJobType.VOICE,
        GenerationJobType.BACKGROUND_AUDIO,
      ]);
      expect(advice.suggestions[0].prompt).toContain('nối tiếp cảnh 1 "Cổng làng"');
      expect(advice.suggestions[1].prompt).toBe('Bà Tư: "Mua rau đi con!"');
    });

    it('flags a video prompt without lighting or camera, and a break in continuity', async () => {
      givenPlan([
        gate,
        market([
          job(GenerationJobType.SCENE_VIDEO, 'chợ quê ban đêm'),
          job(GenerationJobType.VOICE, 'Bà Tư: "Mua rau đi con!"'),
          job(GenerationJobType.BACKGROUND_AUDIO, 'tiếng chợ'),
        ]),
      ]);

      const advice = await advisor(offline).advise('scene-2');

      expect(advice.gaps.map((g) => g.aspect)).toEqual(['camera', 'continuity', 'continuity']);
      expect(advice.gaps[1].message).toContain('Cảnh 1 diễn ra ban ngày');
      expect(advice.gaps[2].message).toContain('Bà Tư');
    });

    it('ignores cancelled generations', async () => {
      givenPlan([market([job(GenerationJobType.SCENE_VIDEO, 'cận cảnh, nắng sớm', GenerationJobStatus.CANCELLED)])]);

      const advice = await advisor(offline).advise('scene-2');

      expect(advice.gaps[0].aspect).toBe('video');
    });

    it('lets Gemini add continuity breaks and write the prompts, keeping only usable ones', async () => {
      givenPlan([gate, market([])]);
      const generate = jest.fn<Promise<string>, [{ json?: boolean; prompt: string }]>().mockResolvedValue(
        JSON.stringify({
          summary: 'Thiếu hình và tiếng',
          continuity: ['Bà Tư đổi áo so với cảnh 1'],
          suggestions: [
            {
              jobType: 'SCENE_VIDEO',
              title: 'Video',
              reason: 'r',
              prompt: 'Chợ quê buổi sáng, nắng sớm, máy lia chậm',
            },
            { jobType: 'NOT_A_TYPE', title: 'x', reason: 'r', prompt: 'y' },
          ],
        }),
      );

      const advice = await advisor({ isAvailable: true, generate }).advise('scene-2');

      expect(advice).toMatchObject({ source: 'ai', summary: 'Thiếu hình và tiếng' });
      expect(advice.gaps.at(-1)).toEqual({ aspect: 'continuity', message: 'Bà Tư đổi áo so với cảnh 1' });
      expect(advice.suggestions).toHaveLength(1);
      expect(generate.mock.calls[0][0].prompt).toContain('PREVIOUS — scene 1: Cổng làng');
    });

    it('checks the continuity of the whole episode, scene by scene', async () => {
      givenPlan([gate, market([job(GenerationJobType.SCENE_VIDEO, 'bà Tư ở chợ ban đêm')])]);

      const report = await advisor(offline).checkPlan('plan-id');

      expect(report.scenes).toEqual([
        { sceneId: 'scene-1', sceneNumber: 1, issues: [] },
        { sceneId: 'scene-2', sceneNumber: 2, issues: [expect.stringContaining('ban đêm')] },
      ]);
    });
  });
});
