import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus, GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { latestAttempts } from 'src/modules/generation-job/latest-attempts';
import { GeminiTextClient } from 'src/modules/generation-job/providers/gemini-text';
import { continuityIssues, type SceneSnapshot } from './scene-continuity';

export type SceneAspect = 'video' | 'voice' | 'audio' | 'lighting' | 'camera' | 'continuity';

export interface SceneGap {
  aspect: SceneAspect;
  message: string;
}

export interface SceneSuggestion {
  jobType: GenerationJobType;
  title: string;
  reason: string;
  prompt: string;
}

export interface SceneLink {
  number: number;
  title: string;
}

export interface SceneAdvice {
  source: 'ai' | 'rules';
  summary: string;
  gaps: SceneGap[];
  suggestions: SceneSuggestion[];
  /** The neighbouring scenes this one must cut together with. */
  previousScene: SceneLink | null;
  nextScene: SceneLink | null;
}

export interface PlanContinuity {
  source: 'ai' | 'rules';
  summary: string;
  scenes: { sceneId: string; sceneNumber: number; issues: string[] }[];
}

const SUGGESTED_TYPES: GenerationJobType[] = [
  GenerationJobType.SCENE_VIDEO,
  GenerationJobType.SCENE_IMAGE,
  GenerationJobType.VOICE,
  GenerationJobType.BACKGROUND_AUDIO,
];
const MAX_CONTINUITY_ISSUES = 4;

// Words a Creator uses when a prompt already covers the aspect (Vietnamese and English).
const LIGHTING_WORDS =
  /ánh sáng|ánh đèn|đèn|nắng|hoàng hôn|bình minh|ban đêm|chiều|tối|neon|light|lighting|sunset|sunrise|golden hour|night/i;
const CAMERA_WORDS =
  /góc máy|máy quay|cận cảnh|toàn cảnh|trung cảnh|lia|zoom|drone|flycam|close-up|wide shot|tracking|pan|dolly|camera/i;

const SCENE_SYSTEM = [
  'You are the assistant director and script supervisor of an AI-produced film. You check one scene before the Creator generates it.',
  'Answer in JSON only: {"summary": string, "continuity": string[], "suggestions": [{"jobType": "SCENE_VIDEO"|"SCENE_IMAGE"|"VOICE"|"BACKGROUND_AUDIO", "title": string, "reason": string, "prompt": string}]}.',
  '- Write everything in Vietnamese.',
  '- "continuity": breaks between this scene and the previous or next scene that are not already listed under "Continuity found" — characters (look, costume), place, time of day, weather, colour palette, sound, story flow. At most 3, [] when it cuts together well.',
  '- "suggestions": cover every gap under "Gaps" and every continuity break, one suggestion per gap at most, at most 4. A lighting, camera or continuity gap is fixed by a SCENE_VIDEO prompt.',
  '- Every prompt continues the previous scene (same characters with the same look, same place unless the script moves, matching light and palette) and leads into the next scene.',
  "- Stay faithful to the film synopsis and to this scene's description and script.",
  '- A SCENE_VIDEO prompt names the subject and action, setting, lighting, camera shot and movement, in 1-3 sentences.',
  '- A VOICE prompt is the spoken line with its speaker, e.g. Minh Anh: "…". A BACKGROUND_AUDIO prompt describes ambience or music and its mood.',
  '- Do not suggest what the scene already has.',
].join('\n');

const PLAN_SYSTEM = [
  'You are the script supervisor of an AI-produced film episode. Check that its scenes cut together.',
  'Answer in JSON only: {"summary": string, "issues": [{"sceneNumber": number, "message": string}]}.',
  '- Write in Vietnamese. An issue belongs to the later scene of a break: characters (look, costume), place, time of day, weather, colour palette, sound, story flow.',
  '- Only real breaks, at most 2 per scene; skip what is already listed under "Found by rules". summary: one sentence on how well the episode flows.',
].join('\n');

interface FilmContext {
  film: string;
  synopsis: string | null;
  genre: string | null;
}

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

const linkOf = (scene: SceneSnapshot): SceneLink => ({ number: scene.number, title: scene.title });

function findGaps(scene: SceneSnapshot): SceneGap[] {
  const has = (type: GenerationJobType) => scene.prompts.some((job) => job.jobType === type);
  const videoPrompts = scene.prompts
    .filter((job) => job.jobType === GenerationJobType.SCENE_VIDEO)
    .map((job) => job.prompt)
    .join(' ');
  const gaps: SceneGap[] = [];

  if (!has(GenerationJobType.SCENE_VIDEO)) {
    gaps.push({ aspect: 'video', message: 'Cảnh chưa có video chính.' });
  } else {
    if (!LIGHTING_WORDS.test(videoPrompts))
      gaps.push({ aspect: 'lighting', message: 'Mô tả video chưa nói rõ ánh sáng.' });
    if (!CAMERA_WORDS.test(videoPrompts))
      gaps.push({ aspect: 'camera', message: 'Mô tả video chưa nói rõ góc máy, chuyển động máy.' });
  }
  if (!has(GenerationJobType.VOICE) && dialogueOf(scene.script)) {
    gaps.push({ aspect: 'voice', message: 'Kịch bản cảnh có lời thoại nhưng chưa có lồng tiếng.' });
  }
  if (!has(GenerationJobType.BACKGROUND_AUDIO)) {
    gaps.push({ aspect: 'audio', message: 'Cảnh chưa có âm thanh nền hoặc nhạc.' });
  }
  return gaps;
}

/** The first spoken line of a scene script ("Name: line" or a quoted line), if it has one. */
function dialogueOf(script: string | null): string | null {
  if (!script) return null;
  const line = script.split('\n').find((l) => /^[^:\n]{1,40}:\s*\S/.test(l.trim()) || /["“].+["”]/.test(l));
  return line?.trim() ?? null;
}

function summaryOf(gaps: SceneGap[], previous: SceneSnapshot | null): string {
  if (gaps.length === 0) {
    return previous
      ? `Cảnh đã đủ hình, tiếng và nối tiếp tốt với cảnh ${previous.number}.`
      : 'Cảnh đã có đủ hình, tiếng và mô tả ánh sáng, góc máy.';
  }
  return `Cảnh còn ${gaps.length} điểm cần xử lý: ${gaps.map((g) => g.message.replace(/\.$/, '').toLowerCase()).join('; ')}.`;
}

const sceneLines = (label: string, scene: SceneSnapshot) =>
  [
    `${label} — scene ${scene.number}: ${scene.title}`,
    scene.description && `  description: ${scene.description}`,
    scene.script && `  script: ${scene.script}`,
    `  generated: ${scene.prompts.map((p) => `${p.jobType}: ${p.prompt}`).join(' | ') || '(nothing yet)'}`,
  ]
    .filter(Boolean)
    .join('\n');

const filmLines = (film: FilmContext) =>
  [`Film: ${film.film}`, film.genre && `Genre: ${film.genre}`, film.synopsis && `Synopsis: ${film.synopsis}`].filter(
    Boolean,
  );

function sceneBrief(
  film: FilmContext,
  previous: SceneSnapshot | null,
  scene: SceneSnapshot,
  next: SceneSnapshot | null,
  gaps: SceneGap[],
): string {
  const lacking = gaps.filter((g) => g.aspect !== 'continuity');
  const continuity = gaps.filter((g) => g.aspect === 'continuity');
  return [
    ...filmLines(film),
    previous ? sceneLines('PREVIOUS', previous) : 'PREVIOUS — none, this is the first scene',
    sceneLines('THIS SCENE', scene),
    next ? sceneLines('NEXT', next) : 'NEXT — none, this is the last scene',
    `Gaps: ${lacking.map((g) => `${g.aspect} — ${g.message}`).join('; ') || '(none)'}`,
    `Continuity found: ${continuity.map((g) => g.message).join('; ') || '(none)'}`,
  ].join('\n');
}

function planBrief(film: FilmContext, scenes: SceneSnapshot[], byRules: Map<number, string[]>): string {
  return [
    ...filmLines(film),
    ...scenes.map((scene) => sceneLines('SCENE', scene)),
    `Found by rules: ${
      [...byRules.entries()]
        .filter(([, issues]) => issues.length > 0)
        .map(([n, issues]) => `scene ${n}: ${issues.join('; ')}`)
        .join(' | ') || '(none)'
    }`,
  ].join('\n');
}

function templateSuggestions(
  film: FilmContext,
  previous: SceneSnapshot | null,
  scene: SceneSnapshot,
  gaps: SceneGap[],
): SceneSuggestion[] {
  const subject = scene.description?.trim() || scene.title;
  const look = previous
    ? `, nối tiếp cảnh ${previous.number} "${previous.title}": giữ nguyên nhân vật, trang phục, tông màu và ánh sáng`
    : '';
  const aspects = new Set(gaps.map((g) => g.aspect));
  const suggestions: SceneSuggestion[] = [];

  const visualGap = gaps.find((g) => ['video', 'lighting', 'camera', 'continuity'].includes(g.aspect));
  if (visualGap) {
    suggestions.push({
      jobType: GenerationJobType.SCENE_VIDEO,
      title: aspects.has('video')
        ? 'Video chính của cảnh'
        : aspects.has('continuity')
          ? 'Nối tiếp cảnh trước'
          : 'Bổ sung ánh sáng và góc máy',
      reason: visualGap.message,
      prompt: `${subject}. Ánh sáng hợp với thời điểm trong cảnh, toàn cảnh mở đầu rồi máy quay tiến chậm vào nhân vật chính${look}.`,
    });
  }
  const line = dialogueOf(scene.script);
  if (aspects.has('voice') && line) {
    suggestions.push({
      jobType: GenerationJobType.VOICE,
      title: 'Lồng tiếng lời thoại',
      reason: 'Kịch bản cảnh có lời thoại.',
      prompt: line,
    });
  }
  if (aspects.has('audio')) {
    suggestions.push({
      jobType: GenerationJobType.BACKGROUND_AUDIO,
      title: 'Âm thanh nền',
      reason: 'Cảnh chưa có âm thanh nền hoặc nhạc.',
      prompt: `Âm thanh môi trường và nhạc nền cho cảnh "${scene.title}"${film.genre ? `, không khí phim ${film.genre}` : ''}${previous ? `, chuyển tiếp mượt từ âm thanh cảnh ${previous.number}` : ''}, âm lượng nhẹ để không lấn lời thoại.`,
    });
  }
  return suggestions;
}
