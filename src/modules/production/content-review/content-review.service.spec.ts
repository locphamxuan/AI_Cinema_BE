import { durationCheck } from './content-review.service';

describe('Episode length check (BR-31)', () => {
  it('warns only beyond 20% of the target, in either direction', () => {
    expect(durationCheck(600, 700)).toMatchObject({ deviationSeconds: 100, warning: false });
    expect(durationCheck(600, 721)).toMatchObject({ deviationSeconds: 121, warning: true });
    expect(durationCheck(600, 470)).toMatchObject({ deviationSeconds: -130, warning: true });
  });

  it('cannot judge a version whose length is unknown', () => {
    expect(durationCheck(600, null)).toEqual({
      targetSeconds: 600,
      actualSeconds: null,
      deviationSeconds: null,
      warning: false,
    });
  });
});
