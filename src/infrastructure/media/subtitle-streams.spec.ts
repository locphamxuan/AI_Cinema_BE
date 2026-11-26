import { isWebVtt, languageOf, planSubtitles } from './subtitle-streams';

describe('languageOf', () => {
  it('maps ISO 639-2 tags (both forms) to the codes the apps use', () => {
    expect(
      ['vie', 'eng', 'chi', 'zho', 'jpn', 'kor', 'fra', 'fre'].map((language) => languageOf({ language })),
    ).toEqual(['vi', 'en', 'zh', 'zh', 'ja', 'ko', 'fr', 'fr']);
    expect(languageOf({ language: 'VIE' })).toBe('vi');
    expect(languageOf({ language: 'en-US' })).toBe('en');
  });

  it('falls back to the stream title when the tag is missing or "und"', () => {
    expect(languageOf({ language: 'und', title: 'Tiếng Việt' })).toBe('vi');
    expect(languageOf({ title: 'English' })).toBe('en');
    expect(languageOf({ title: 'kor' })).toBe('ko');
    expect(languageOf({ language: 'und', title: 'Track 1' })).toBeUndefined();
    expect(languageOf({})).toBeUndefined();
  });

  it('does not guess a tag it does not know, whatever the title says', () => {
    expect(languageOf({ language: 'spa', title: 'English' })).toBeUndefined();
  });
});

describe('planSubtitles', () => {
  it('keeps text streams in a known language, Vietnamese as the default', () => {
    const plan = planSubtitles([
      { position: 0, codec: 'mov_text', language: 'eng' },
      { position: 1, codec: 'subrip', language: 'vie' },
    ]);

    expect(plan.tracks).toEqual([
      { position: 0, language: 'en', isDefault: false },
      { position: 1, language: 'vi', isDefault: true },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('sets no default without a Vietnamese track', () => {
    const plan = planSubtitles([{ position: 0, codec: 'webvtt', language: 'eng' }]);
    expect(plan.tracks.some((track) => track.isDefault)).toBe(false);
  });

  it('skips image-based codecs, unknown languages and a second stream of the same language', () => {
    const plan = planSubtitles([
      { position: 0, codec: 'hdmv_pgs_subtitle', language: 'vie' },
      { position: 1, codec: 'dvd_subtitle', language: 'eng' },
      { position: 2, codec: 'mov_text', language: 'und' },
      { position: 3, codec: 'ass', language: 'vie', title: 'Full' },
      { position: 4, codec: 'mov_text', language: 'vie', title: 'Signs' },
    ]);

    expect(plan.tracks).toEqual([{ position: 3, language: 'vi', isDefault: true }]);
    expect(plan.skipped).toHaveLength(4);
    expect(plan.skipped[0]).toContain('image-based');
    expect(plan.skipped[2]).toContain('unknown language');
    expect(plan.skipped[3]).toContain('already kept');
  });

  it('plans nothing for a file without subtitles', () => {
    expect(planSubtitles([])).toEqual({ tracks: [], skipped: [] });
  });
});

describe('isWebVtt', () => {
  it('accepts a header with at least one cue, with or without a byte order mark', () => {
    expect(isWebVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nXin chào\n')).toBe(true);
    expect(isWebVtt('\uFEFFWEBVTT - Vietnamese\r\n\r\n00:00.000 --> 00:01.000\r\nHi\r\n')).toBe(true);
  });

  it('refuses an empty file, a file without cues and another format', () => {
    expect(isWebVtt('')).toBe(false);
    expect(isWebVtt('WEBVTT\n\n')).toBe(false);
    expect(isWebVtt('1\n00:00:00,000 --> 00:00:01,000\nHi\n')).toBe(false);
    expect(isWebVtt('WEBVTTX\n\n00:00.000 --> 00:01.000\nHi')).toBe(false);
  });
});
