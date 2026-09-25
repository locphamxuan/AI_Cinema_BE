import { GenerationJobType } from '@prisma/client';
import type { SceneSnapshot } from './scene-continuity';
import type { FilmContext, SceneGap, SceneLink, SceneSuggestion } from './scene-advice.types';

/** Rule-based advice: what a scene lacks and template prompts, used when Gemini is not. */

export const SUGGESTED_TYPES: GenerationJobType[] = [
  GenerationJobType.SCENE_VIDEO,
  GenerationJobType.SCENE_IMAGE,
  GenerationJobType.VOICE,
  GenerationJobType.BACKGROUND_AUDIO,
];
export const MAX_CONTINUITY_ISSUES = 4;

// Words a Creator uses when a prompt already covers the aspect (Vietnamese and English).
const LIGHTING_WORDS =
  /ánh sáng|ánh đèn|đèn|nắng|hoàng hôn|bình minh|ban đêm|chiều|tối|neon|light|lighting|sunset|sunrise|golden hour|night/i;
const CAMERA_WORDS =
  /góc máy|máy quay|cận cảnh|toàn cảnh|trung cảnh|lia|zoom|drone|flycam|close-up|wide shot|tracking|pan|dolly|camera/i;

export const linkOf = (scene: SceneSnapshot): SceneLink => ({ number: scene.number, title: scene.title });

export function findGaps(scene: SceneSnapshot): SceneGap[] {
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
export function dialogueOf(script: string | null): string | null {
  if (!script) return null;
  const line = script.split('\n').find((l) => /^[^:\n]{1,40}:\s*\S/.test(l.trim()) || /["“].+["”]/.test(l));
  return line?.trim() ?? null;
}

export function summaryOf(gaps: SceneGap[], previous: SceneSnapshot | null): string {
  if (gaps.length === 0) {
    return previous
      ? `Cảnh đã đủ hình, tiếng và nối tiếp tốt với cảnh ${previous.number}.`
      : 'Cảnh đã có đủ hình, tiếng và mô tả ánh sáng, góc máy.';
  }
  return `Cảnh còn ${gaps.length} điểm cần xử lý: ${gaps.map((g) => g.message.replace(/\.$/, '').toLowerCase()).join('; ')}.`;
}

export function templateSuggestions(
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
