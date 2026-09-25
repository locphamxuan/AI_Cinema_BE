import { ConflictException, Injectable } from '@nestjs/common';
import { GenerationJobStatus, GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerationJobService } from 'src/modules/generation-job/generation-job.service';
import { latestAttempts } from 'src/modules/generation-job/latest-attempts';
import { buildWebVtt } from './webvtt';

export interface EpisodeScene {
  id: string;
  title: string;
  description: string | null;
  scriptText: string | null;
  durationSeconds: number;
}

export interface SubtitleTrack {
  language: string;
  content: string;
}

/**
 * Every episode ships a subtitle track per target language of its plan. The first
 * language is subtitled from each scene's script (SUBTITLE), the others are
 * translated (TRANSLATION). Lines already generated are reused; missing ones are
 * generated through the normal job pipeline, so they are routed and charged like
 * any other generation (BR-40, BR-41).
 */
@Injectable()
export class EpisodeSubtitleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generationJobs: GenerationJobService,
  ) {}

  async buildTracks(
    planId: string,
    scenes: EpisodeScene[],
    languages: string[],
    requestedBy: string,
  ): Promise<SubtitleTrack[]> {
    const jobs = await this.prisma.generationJob.findMany({
      where: {
        productionPlanId: planId,
        jobType: { in: [GenerationJobType.SUBTITLE, GenerationJobType.TRANSLATION] },
        language: { in: languages },
      },
      include: { generatedAssets: true },
    });
    const lines = new Map<string, string>();
    for (const job of latestAttempts(jobs)) {
      const text = job.generatedAssets.find((asset) => asset.contentText)?.contentText;
      if (job.status === GenerationJobStatus.COMPLETED && job.sceneId && text) {
        lines.set(`${job.sceneId}:${job.language}`, text);
      }
    }

    const tracks: SubtitleTrack[] = [];
    for (const [index, language] of languages.entries()) {
      const jobType = index === 0 ? GenerationJobType.SUBTITLE : GenerationJobType.TRANSLATION;
      const cues: { text: string; durationSeconds: number }[] = [];
      for (const scene of scenes) {
        const text =
          lines.get(`${scene.id}:${language}`) ??
          (await this.generateLine(planId, scene, jobType, language, requestedBy));
        cues.push({ text, durationSeconds: scene.durationSeconds });
      }
      tracks.push({ language, content: buildWebVtt(cues) });
    }
    return tracks;
  }

  private async generateLine(
    planId: string,
    scene: EpisodeScene,
    jobType: GenerationJobType,
    language: string,
    requestedBy: string,
  ): Promise<string> {
    const queued = await this.generationJobs.create(
      planId,
      { jobType, language, sceneId: scene.id, prompt: scene.scriptText ?? scene.description ?? scene.title },
      requestedBy,
    );
    const job = await this.generationJobs.run(queued.id);
    const text = job.generatedAssets.find((asset) => asset.contentText)?.contentText;
    if (job.status !== GenerationJobStatus.COMPLETED || !text) {
      throw new ConflictException(
        `Could not generate "${language}" subtitles for scene "${scene.title}": ${job.errorMessage ?? 'no text returned'}`,
      );
    }
    return text;
  }
}
