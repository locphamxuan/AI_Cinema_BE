import { blendPopularity } from './popularity';

describe('blendPopularity', () => {
  it('scales plays and hearts to the top movie each, then mixes 0.7 / 0.3', () => {
    const score = blendPopularity([
      { id: 'played', views: 10_000, likes: 0 },
      { id: 'loved', views: 5_000, likes: 40 },
    ]);
    expect(score.get('played')).toBeCloseTo(0.7);
    expect(score.get('loved')).toBeCloseTo(0.7 * 0.5 + 0.3 * 1);
  });

  it('scores 0 when nothing was watched or liked yet', () => {
    expect(blendPopularity([{ id: 'a', views: 0, likes: 0 }]).get('a')).toBe(0);
  });
});
