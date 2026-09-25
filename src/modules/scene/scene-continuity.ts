import { GenerationJobType } from '@prisma/client';

/**
 * Continuity between neighbouring scenes, checked from what the Creator wrote: the
 * scene description, its script and the prompts of its generations. The rules catch
 * the clear breaks (time of day jumping, a speaking character missing from the
 * picture); the LLM advisor adds the subtler ones (costume, place, colour).
 */

export interface SceneSnapshot {
  id: string;
  number: number;
  title: string;
  description: string | null;
  script: string | null;
  /** Live (latest, not cancelled or failed) generations of the scene. */
  prompts: { jobType: GenerationJobType; prompt: string }[];
}

type TimeOfDay = 'day' | 'dusk' | 'night';

const TIME_WORDS: [TimeOfDay, RegExp][] = [
  ['night', /ban đêm|nửa đêm|đêm khuya|trong đêm|buổi tối|trời tối|\bnight\b|midnight/i],
  ['dusk', /hoàng hôn|chạng vạng|chiều tà|buổi chiều|sunset|dusk|golden hour/i],
  ['day', /ban ngày|buổi sáng|sáng sớm|buổi trưa|giữa trưa|bình minh|nắng gắt|\bmorning\b|daytime|\bnoon\b|sunrise/i],
];

const TIME_LABEL: Record<TimeOfDay, string> = { day: 'ban ngày', dusk: 'lúc chiều tối', night: 'ban đêm' };

const VISUAL_TYPES: GenerationJobType[] = [GenerationJobType.SCENE_VIDEO, GenerationJobType.SCENE_IMAGE];

export const visualPrompts = (scene: SceneSnapshot) =>
  scene.prompts
    .filter((p) => VISUAL_TYPES.includes(p.jobType))
    .map((p) => p.prompt)
    .join(' ');

/** When the scene happens, from its visual prompts first, else its description. */
export function timeOfDay(scene: SceneSnapshot): TimeOfDay | null {
  for (const text of [visualPrompts(scene), scene.description ?? '']) {
    const found = TIME_WORDS.find(([, words]) => words.test(text));
    if (found) return found[0];
  }
  return null;
}

/** Speakers of a script: the names before "Name:" at the start of a line. */
export function charactersOf(script: string | null): string[] {
  if (!script) return [];
  const names = script
    .split('\n')
    .map((line) => /^([^:\n"“]{1,40}):\s*\S/.exec(line.trim())?.[1].trim())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

/** Clear breaks between a scene and the one before it. */
export function continuityIssues(previous: SceneSnapshot | null, scene: SceneSnapshot): string[] {
  const issues: string[] = [];

  if (previous) {
    const before = timeOfDay(previous);
    const now = timeOfDay(scene);
    if (before && now && before !== now) {
      issues.push(
        `Cảnh ${previous.number} diễn ra ${TIME_LABEL[before]} nhưng cảnh này ${TIME_LABEL[now]}. Nếu không cố ý chuyển thời gian, hãy thống nhất ánh sáng giữa hai cảnh.`,
      );
    }
  }

  const pictured = visualPrompts(scene).toLowerCase();
  if (pictured) {
    for (const name of charactersOf(scene.script)) {
      if (!pictured.includes(name.toLowerCase())) {
        issues.push(`Nhân vật ${name} có lời thoại trong cảnh nhưng chưa xuất hiện trong mô tả hình.`);
      }
    }
  }
  return issues;
}
