import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { latestAttempts } from 'src/modules/generation-job/latest-attempts';
import { GeminiTextClient } from 'src/modules/generation-job/providers/gemini-text';
import { continuityIssues, type SceneSnapshot } from './scene-continuity';
import type { FilmContext, PlanContinuity, SceneAdvice, SceneGap, SceneSuggestion } from './scene-advice.types';
import { PLAN_SYSTEM, SCENE_SYSTEM, planBrief, sceneBrief } from './scene-advice.prompts';
import {
  MAX_CONTINUITY_ISSUES,
  SUGGESTED_TYPES,
  findGaps,
  linkOf,
  summaryOf,
  templateSuggestions,
} from './scene-advice.rules';

/**
 * Checks a scene against the film and its neighbours: what it still lacks (main video,
 * voice-over, sound, lighting and camera in its video prompt) and where it breaks
 * continuity with the previous scene. Suggested prompts carry the previous scene over
 * and lead into the next one. Gemini writes them when available; otherwise templates do.
 */
@Injectable()
export class SceneAdvisorService {
  private readonly logger = new Logger(SceneAdvisorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiTextClient,
  ) {}

  async advise(sceneId: string): Promise<SceneAdvice> {
    const scene = await this.prisma.scene.findUnique({ where: { id: sceneId }, select: { productionPlanId: true } });
    if (!scene) throw new NotFoundException(`Scene with id "${sceneId}" does not exist`);
    const { film, scenes } = await this.loadPlan(scene.productionPlanId);

    const index = scenes.findIndex((s) => s.id === sceneId);
    const current = scenes[index];
    const previous = scenes[index - 1] ?? null;
    const next = scenes[index + 1] ?? null;
    const links = { previousScene: previous && linkOf(previous), nextScene: next && linkOf(next) };

    const gaps = [
      ...findGaps(current),
      ...continuityIssues(previous, current).map((message) => ({ aspect: 'continuity' as const, message })),
    ];

    if (this.gemini.isAvailable) {
      try {
        return { source: 'ai', ...(await this.askScene(film, previous, current, next, gaps)), ...links };
      } catch (error) {
        this.logger.warn(`Scene advisor fell back to the templates: ${(error as Error).message}`);
      }
    }
    return {
      source: 'rules',
      summary: summaryOf(gaps, previous),
      gaps,
      suggestions: templateSuggestions(film, previous, current, gaps),
      ...links,
    };
  }

  /** Continuity of a whole episode: every break between neighbouring scenes, per scene. */
  async checkPlan(planId: string): Promise<PlanContinuity> {
    const { film, scenes } = await this.loadPlan(planId);
    const byRules = new Map(scenes.map((s, i) => [s.number, continuityIssues(scenes[i - 1] ?? null, s)]));
    const result = (source: PlanContinuity['source'], summary: string, extra = new Map<number, string[]>()) => ({
      source,
      summary,
      scenes: scenes.map((s) => ({
        sceneId: s.id,
        sceneNumber: s.number,
        issues: [...byRules.get(s.number)!, ...(extra.get(s.number) ?? [])].slice(0, MAX_CONTINUITY_ISSUES),
      })),
    });
    const ruleCount = [...byRules.values()].flat().length;
    const ruleSummary =
      ruleCount === 0 ? 'Các cảnh đang nối tiếp nhau hợp lý.' : `Có ${ruleCount} chỗ các cảnh chưa khớp nhau.`;

    if (!this.gemini.isAvailable || scenes.length < 2) return result('rules', ruleSummary);
    try {
      const answer = await this.gemini.generate({
        system: PLAN_SYSTEM,
        prompt: planBrief(film, scenes, byRules),
        json: true,
      });
      const parsed = JSON.parse(answer) as { summary?: unknown; issues?: unknown };
      const extra = new Map<number, string[]>();
      for (const issue of Array.isArray(parsed.issues) ? parsed.issues : []) {
        const { sceneNumber, message } = (issue ?? {}) as { sceneNumber?: unknown; message?: unknown };
        if (
          typeof sceneNumber === 'number' &&
          byRules.has(sceneNumber) &&
          typeof message === 'string' &&
          message.trim()
        ) {
          extra.set(sceneNumber, [...(extra.get(sceneNumber) ?? []), message.trim()]);
        }
      }
      return result('ai', typeof parsed.summary === 'string' ? parsed.summary : ruleSummary, extra);
    } catch (error) {
      this.logger.warn(`Continuity check fell back to the rules: ${(error as Error).message}`);
      return result('rules', ruleSummary);
    }
  }

  private async askScene(
    film: FilmContext,
    previous: SceneSnapshot | null,
    scene: SceneSnapshot,
    next: SceneSnapshot | null,
    gaps: SceneGap[],
  ) {
    const answer = await this.gemini.generate({
      system: SCENE_SYSTEM,
      prompt: sceneBrief(film, previous, scene, next, gaps),
      json: true,
    });
    const parsed = JSON.parse(answer) as { summary?: unknown; continuity?: unknown; suggestions?: unknown };
    const continuity = (Array.isArray(parsed.continuity) ? parsed.continuity : [])
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((message) => ({ aspect: 'continuity' as const, message: message.trim() }));
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter(
        (s): s is SceneSuggestion =>
          typeof s === 'object' &&
          s !== null &&
          SUGGESTED_TYPES.includes((s as SceneSuggestion).jobType) &&
          typeof (s as SceneSuggestion).prompt === 'string' &&
          (s as SceneSuggestion).prompt.trim().length > 0,
      )
      .slice(0, 4)
      .map((s) => ({
        jobType: s.jobType,
        title: String(s.title ?? ''),
        reason: String(s.reason ?? ''),
        prompt: s.prompt.trim(),
      }));
    const allGaps = [...gaps, ...continuity].slice(0, gaps.length + MAX_CONTINUITY_ISSUES);
    if (allGaps.length > 0 && suggestions.length === 0) throw new Error('Gemini gave no usable suggestion');
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : summaryOf(allGaps, previous),
      gaps: allGaps,
      suggestions,
    };
  }

  /** The film and every scene of the plan in order, each with its live generations. */
  private async loadPlan(planId: string): Promise<{ film: FilmContext; scenes: SceneSnapshot[] }> {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: {
        productionProject: { select: { title: true, description: true, primaryGenre: { select: { name: true } } } },
        scenes: { orderBy: { sceneNumber: 'asc' }, include: { generationJobs: true } },
      },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);

    const project = plan.productionProject;
    return {
      film: { film: project.title, synopsis: project.description, genre: project.primaryGenre?.name ?? null },
      scenes: plan.scenes.map((scene) => ({
        id: scene.id,
        number: scene.sceneNumber,
        title: scene.title,
        description: scene.description,
        script: scene.scriptText,
        prompts: latestAttempts(scene.generationJobs)
          .filter((job) => job.status !== GenerationJobStatus.CANCELLED && job.status !== GenerationJobStatus.FAILED)
          .map((job) => ({ jobType: job.jobType, prompt: job.rawPrompt ?? '' })),
      })),
    };
  }
}
