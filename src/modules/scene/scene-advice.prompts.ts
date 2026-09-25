import type { SceneSnapshot } from './scene-continuity';
import type { FilmContext, SceneGap } from './scene-advice.types';

/** What the scene advisor asks Gemini: system rules and the brief of the film and scenes. */

export const SCENE_SYSTEM = [
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

export const PLAN_SYSTEM = [
  'You are the script supervisor of an AI-produced film episode. Check that its scenes cut together.',
  'Answer in JSON only: {"summary": string, "issues": [{"sceneNumber": number, "message": string}]}.',
  '- Write in Vietnamese. An issue belongs to the later scene of a break: characters (look, costume), place, time of day, weather, colour palette, sound, story flow.',
  '- Only real breaks, at most 2 per scene; skip what is already listed under "Found by rules". summary: one sentence on how well the episode flows.',
].join('\n');

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

export function sceneBrief(
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

export function planBrief(film: FilmContext, scenes: SceneSnapshot[], byRules: Map<number, string[]>): string {
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
