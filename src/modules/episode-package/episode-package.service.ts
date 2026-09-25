import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AssetType,
  EpisodePackageStatus,
  GeneratedAssetStatus,
  GenerationJobStatus,
  GenerationJobType,
  Prisma,
  ProductionPlanStatus,
  SceneStatus,
  SubmissionStatus,
  SubmissionType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { latestAttempts } from 'src/modules/generation-job/latest-attempts';
import { assertProjectOpen } from 'src/modules/production-project/project-lifecycle';
import { CreateEpisodePackageRequestDto } from './dto/create-episode-package.request.dto';
import { EpisodeSubtitleService, type EpisodeScene } from './episode-subtitle.service';
import { VIDEO_TRANSCODER, type SceneClip, type VideoTranscoder } from './video-transcoder';

const PACKAGE_INCLUDE = {
  assets: { include: { generatedAsset: true } },
  assemblyJob: true,
  reviews: true,
  complianceChecks: true,
  aiContentLabels: true,
  submissions: true,
  publications: true,
  subtitles: { select: { language: true } },
} satisfies Prisma.EpisodePackageInclude;

@Injectable()
export class EpisodePackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subtitles: EpisodeSubtitleService,
    @Inject(VIDEO_TRANSCODER) private readonly transcoder: VideoTranscoder,
  ) {}

  async assemble(planId: string, dto: CreateEpisodePackageRequestDto, assembledBy: string) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: {
        scenes: { orderBy: { sceneNumber: 'asc' } },
        productionProject: { select: { subtitleLanguages: true, status: true } },
      },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    assertProjectOpen(plan.productionProject);
    if (plan.status !== ProductionPlanStatus.APPROVED) {
      throw new ConflictException(
        `An episode package can only be assembled for an APPROVED plan, current status "${plan.status}"`,
      );
    }

    await this.assertCutReplaceable(planId);

    const notCompleted = plan.scenes.filter((s) => s.status !== SceneStatus.COMPLETED);
    if (notCompleted.length > 0) {
      throw new ConflictException(
        `All scenes must be COMPLETED before assembling. Still pending: ${notCompleted.map((s) => s.title).join(', ')}`,
      );
    }

    if (dto.assemblyJobId) {
      const job = await this.prisma.generationJob.findFirst({
        where: { id: dto.assemblyJobId, productionPlanId: planId },
      });
      if (!job)
        throw new BadRequestException(`Assembly job "${dto.assemblyJobId}" does not belong to plan "${planId}"`);
      if (job.jobType !== GenerationJobType.VIDEO_ASSEMBLY) {
        throw new BadRequestException('assemblyJobId must reference a VIDEO_ASSEMBLY job');
      }
      if (job.status !== GenerationJobStatus.COMPLETED) {
        throw new ConflictException('The VIDEO_ASSEMBLY job must be COMPLETED before assembling the package');
      }
    }

    let assetIds: string[] | null = null;
    if (dto.assetIds && dto.assetIds.length > 0) {
      assetIds = [...new Set(dto.assetIds)];
      const count = await this.prisma.generatedAsset.count({
        where: {
          id: { in: assetIds },
          generationJob: { productionPlanId: planId },
        },
      });
      if (count !== assetIds.length) {
        throw new BadRequestException('Some assetIds do not belong to this plan');
      }
    }

    // The final cut: every scene's latest video, transcoded into the stream ladder,
    // with a subtitle track per target language timed to those clips.
    const clips = await this.sceneClips(planId, plan.scenes);
    const scenes: EpisodeScene[] = plan.scenes.map((scene, index) => ({
      ...scene,
      durationSeconds: clips[index].durationSeconds,
    }));
    const languages = plan.targetLanguages.length > 0 ? plan.targetLanguages : plan.productionProject.subtitleLanguages;
    const tracks = await this.subtitles.buildTracks(planId, scenes, languages, assembledBy);
    const cut = await this.transcoder.transcode(clips);

    return this.prisma.$transaction(async (tx) => {
      const lastPackage = await tx.episodePackage.findFirst({
        where: { productionPlanId: planId },
        orderBy: { packageVersion: 'desc' },
        select: { packageVersion: true },
      });

      await tx.episodePackage.updateMany({
        where: { productionPlanId: planId, status: EpisodePackageStatus.ASSEMBLED },
        data: { status: EpisodePackageStatus.SUPERSEDED },
      });

      const pkg = await tx.episodePackage.create({
        data: {
          productionPlanId: planId,
          packageVersion: (lastPackage?.packageVersion ?? 0) + 1,
          assembledBy,
          assemblyJobId: dto.assemblyJobId,
          durationSeconds: Math.round(cut.durationSeconds),
          streamUrl: cut.streamUrl,
          qualities: cut.qualities,
          subtitles: { create: tracks },
        },
      });

      let links = assetIds;
      if (!links) {
        const assets = await tx.generatedAsset.findMany({
          where: {
            generationJob: { productionPlanId: planId },
            status: { in: [GeneratedAssetStatus.GENERATED, GeneratedAssetStatus.ACCEPTED] },
          },
          select: { id: true },
        });
        links = assets.map((a) => a.id);
      }

      if (links.length > 0) {
        await tx.episodePackageAsset.createMany({
          data: links.map((generatedAssetId) => ({ episodePackageId: pkg.id, generatedAssetId })),
        });
      }

      return tx.episodePackage.findUnique({ where: { id: pkg.id }, include: PACKAGE_INCLUDE });
    });
  }

  async findAll(planId: string) {
    await this.requirePlan(planId);
    return this.prisma.episodePackage.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: { assets: { include: { generatedAsset: true } }, subtitles: { select: { language: true } } },
    });
  }

  async findById(packageId: string) {
    const pkg = await this.prisma.episodePackage.findUnique({
      where: { id: packageId },
      include: {
        assets: { include: { generatedAsset: true } },
        assemblyJob: true,
        reviews: { include: { reviewer: { select: { fullName: true } } } },
        complianceChecks: { include: { policy: true } },
        aiContentLabels: { include: { policy: true } },
        submissions: true,
        publications: true,
        subtitles: { select: { language: true } },
      },
    });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    return pkg;
  }

  /** Subtitle track of a package as a WebVTT document. */
  async findSubtitle(packageId: string, language: string) {
    const subtitle = await this.prisma.episodePackageSubtitle.findUnique({
      where: { episodePackageId_language: { episodePackageId: packageId, language } },
    });
    if (!subtitle) throw new NotFoundException(`Package "${packageId}" has no "${language}" subtitles`);
    return subtitle.content;
  }

  /** Latest usable video of each scene, in scene order; its length falls back to the scene's target. */
  private async sceneClips(
    planId: string,
    scenes: { id: string; title: string; targetDurationSeconds: number }[],
  ): Promise<SceneClip[]> {
    const jobs = await this.prisma.generationJob.findMany({
      where: { productionPlanId: planId, jobType: GenerationJobType.SCENE_VIDEO },
      orderBy: { completedAt: 'asc' },
      include: { generatedAssets: true },
    });
    const completed = latestAttempts(jobs).filter((job) => job.status === GenerationJobStatus.COMPLETED);
    return scenes.map((scene) => {
      const video = completed
        .filter((job) => job.sceneId === scene.id)
        .flatMap((job) => job.generatedAssets)
        .filter(
          (asset) =>
            asset.assetType === AssetType.VIDEO &&
            asset.storageKey &&
            asset.status !== GeneratedAssetStatus.VALIDATION_FAILED,
        )
        .pop();
      if (!video?.storageKey) throw new ConflictException(`Scene "${scene.title}" has no video to assemble`);
      return {
        storageKey: video.storageKey,
        durationSeconds: Number(video.durationSeconds ?? scene.targetDurationSeconds),
      };
    });
  }

  /**
   * A new cut replaces the current one only before it is handed in or after the
   * Reviewer sent it back: re-assembling would otherwise swap the cut under an
   * audit in progress, or undo an approval.
   */
  private async assertCutReplaceable(planId: string) {
    const current = await this.prisma.episodePackage.findFirst({
      where: { productionPlanId: planId, status: EpisodePackageStatus.ASSEMBLED },
      include: {
        submissions: { where: { submissionType: SubmissionType.EPISODE }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const status = current?.submissions[0]?.status;
    if (status === SubmissionStatus.SUBMITTED || status === SubmissionStatus.UNDER_REVIEW) {
      throw new ConflictException('The current cut is waiting for the Reviewer; it can be replaced once sent back');
    }
    if (status === SubmissionStatus.APPROVED) {
      throw new ConflictException('The current cut was approved and can no longer be replaced');
    }
  }

  private async requirePlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    return plan;
  }
}
