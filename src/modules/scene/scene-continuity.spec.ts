import { GenerationJobType } from '@prisma/client';
import { charactersOf, continuityIssues, timeOfDay, type SceneSnapshot } from './scene-continuity';

const snapshot = (number: number, video: string, extra: Partial<SceneSnapshot> = {}): SceneSnapshot => ({
  id: `s${number}`,
  number,
  title: `Cảnh ${number}`,
  description: null,
  script: null,
  prompts: video ? [{ jobType: GenerationJobType.SCENE_VIDEO, prompt: video }] : [],
  ...extra,
});

describe('scene continuity', () => {
  it.each([
    ['con hẻm ban đêm dưới đèn neon', 'night'],
    ['chợ buổi sáng, nắng nhẹ', 'day'],
    ['cánh đồng lúc hoàng hôn', 'dusk'],
    ['phòng khách, ánh sáng dịu', null],
  ])('reads the time of day of "%s"', (video, time) => {
    expect(timeOfDay(snapshot(1, video))).toBe(time);
  });

  it('falls back to the description when the prompts do not say', () => {
    expect(timeOfDay(snapshot(1, '', { description: 'Buổi tối ở nhà bà Tư' }))).toBe('night');
  });

  it('reads the speakers of a script', () => {
    expect(charactersOf('Minh Anh: Chào\nBà Tư: "Ừ"\nMinh Anh: Đi thôi\n(im lặng)')).toEqual(['Minh Anh', 'Bà Tư']);
  });

  it('flags a jump in time of day and a speaker missing from the picture', () => {
    const issues = continuityIssues(
      snapshot(1, 'cổng làng buổi sáng'),
      snapshot(2, 'chợ quê ban đêm', { script: 'Bà Tư: Mua rau đi' }),
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('Cảnh 1 diễn ra ban ngày nhưng cảnh này ban đêm');
    expect(issues[1]).toContain('Bà Tư');
  });

  it('accepts scenes that cut together', () => {
    const issues = continuityIssues(
      snapshot(1, 'cổng làng buổi sáng'),
      snapshot(2, 'bà Tư ở chợ buổi sáng', { script: 'Bà Tư: Mua rau đi' }),
    );
    expect(issues).toEqual([]);
  });
});
