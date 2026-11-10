import { DEFAULT_MAX_QUALITY, maxQualityOf, qualityCeiling } from './playback-quality';

describe('playback-quality', () => {
  it('reads the pixel ceiling of a ladder label', () => {
    expect(qualityCeiling('1080p')).toBe(1080);
    expect(qualityCeiling('360p')).toBe(360);
  });

  it('falls back to the default ceiling for an unknown or removed label', () => {
    expect(qualityCeiling('8k')).toBe(720);
    expect(maxQualityOf({ maxQuality: '8k' })).toBe(DEFAULT_MAX_QUALITY);
    expect(maxQualityOf(null)).toBe(DEFAULT_MAX_QUALITY);
  });
});
