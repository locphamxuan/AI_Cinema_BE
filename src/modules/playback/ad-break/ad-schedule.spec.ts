import { AD_EDGE_SECONDS, planCues, randomPositions, weightedOrder } from './ad-schedule';

const ads = [
  { id: 'ad-1', weight: 1 },
  { id: 'ad-2', weight: 1 },
];

describe('randomPositions (BR-32)', () => {
  it('draws one cue inside each equal part of the clean window', () => {
    // Window 60..1260 split in two parts of 600s; random 0 and 0.5 land at the part start and middle.
    const draws = [0, 0.5];
    expect(randomPositions(1320, 2, () => draws.shift()!)).toEqual([60, 960]);
  });

  it('keeps every cue out of the first and last minute', () => {
    for (let run = 0; run < 50; run++) {
      for (const position of randomPositions(1320, 3)) {
        expect(position).toBeGreaterThanOrEqual(AD_EDGE_SECONDS);
        expect(position).toBeLessThan(1320 - AD_EDGE_SECONDS);
      }
    }
  });

  it('answers nothing for a zero count or an episode too short for a clean window', () => {
    expect(randomPositions(1320, 0)).toEqual([]);
    expect(randomPositions(100, 1)).toEqual([]);
  });
});

describe('weightedOrder', () => {
  it('draws every ad exactly once, heavier ones first on average', () => {
    const weighted = [{ weight: 1 }, { weight: 100 }, { weight: 1 }];
    const firsts = Array.from({ length: 20 }, () => weightedOrder(weighted)[0]?.weight);
    expect(firsts).toContain(100);
    expect(weightedOrder(weighted)).toHaveLength(3);
  });

  it('puts an ad first in proportion to its weight', () => {
    const ads = [
      { id: 'heavy', weight: 100 },
      { id: 'light', weight: 10 },
    ];
    // Evenly spread draws stand for a fair random source, so the count is exact rather than flaky.
    const draws = 1100;
    const firsts = Array.from({ length: draws }, (_, i) => weightedOrder(ads, () => (i + 0.5) / draws)[0].id);
    const heavy = firsts.filter((id) => id === 'heavy').length;

    expect(heavy).toBe(1000);
    expect(heavy / (draws - heavy)).toBe(10);
  });
});

describe('planCues', () => {
  it('uses every cue the Admin placed, in order, whatever the platform cap', () => {
    const cues = planCues({
      slots: [
        { positionSeconds: 900, adId: null },
        { positionSeconds: 30, adId: 'ad-2' },
        { positionSeconds: 300, adId: null },
      ],
      eligible: ads,
      durationSeconds: 1200,
      fallbackCount: 1,
    });
    expect(cues.map((cue) => cue.positionSeconds)).toEqual([30, 300, 900]);
    // The pinned ad plays at its cue; an Admin cue may sit inside the first minute.
    expect(cues[0].adId).toBe('ad-2');
  });

  it('repeats ads only after every valid ad has played when the Admin asks for more cues', () => {
    const cues = planCues({
      slots: [100, 200, 300, 400].map((positionSeconds) => ({ positionSeconds, adId: null })),
      eligible: ads,
      durationSeconds: 1200,
      fallbackCount: 0,
    });
    expect(new Set(cues.slice(0, 2).map((cue) => cue.adId))).toEqual(new Set(['ad-1', 'ad-2']));
    expect(new Set(cues.slice(2).map((cue) => cue.adId))).toEqual(new Set(['ad-1', 'ad-2']));
  });

  it('draws instead of a pinned ad that is paused or out of its window, and drops cues past the end', () => {
    const cues = planCues({
      slots: [
        { positionSeconds: 100, adId: 'ad-gone' },
        { positionSeconds: 1500, adId: null },
      ],
      eligible: ads,
      durationSeconds: 1200,
      fallbackCount: 2,
    });
    expect(cues).toHaveLength(1);
    expect(['ad-1', 'ad-2']).toContain(cues[0].adId);
  });

  it('falls back to random cues, one distinct ad each, when the episode has none placed (P4-4)', () => {
    const cues = planCues({ slots: [], eligible: [ads[0]], durationSeconds: 1320, fallbackCount: 3 });
    // Only one distinct ad is valid, so the episode gets one cue instead of cycling it.
    expect(cues).toHaveLength(1);
    expect(cues[0].positionSeconds).toBeGreaterThanOrEqual(AD_EDGE_SECONDS);
  });

  it('plans nothing without a valid ad or a known duration', () => {
    const slots = [{ positionSeconds: 100, adId: null }];
    expect(planCues({ slots, eligible: [], durationSeconds: 1200, fallbackCount: 2 })).toEqual([]);
    expect(planCues({ slots, eligible: ads, durationSeconds: null, fallbackCount: 2 })).toEqual([]);
  });
});
