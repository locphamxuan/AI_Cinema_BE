/** A subtitle stream of a delivered file as ffprobe lists it. */
export interface SubtitleStream {
  /** Place among the subtitle streams of the file: N in `-map 0:s:N`. */
  position: number;
  codec?: string;
  /** Usually ISO 639-2, e.g. 'vie'; 'und' or absent when the studio did not set one. */
  language?: string;
  title?: string;
}

/** A subtitle stream worth turning into a WebVTT track. */
export interface SubtitleTrackPlan {
  position: number;
  /** BCP-47 code the apps use (`common/validation/language-code.ts`), e.g. 'vi'. */
  language: string;
  isDefault: boolean;
}

export interface SubtitlePlan {
  tracks: SubtitleTrackPlan[];
  /** Why each other stream is left out, for the logs. */
  skipped: string[];
}

/** Pictures of text (DVD, Blu-ray, DVB): they cannot become WebVTT without OCR. */
const IMAGE_CODECS = new Set(['dvd_subtitle', 'hdmv_pgs_subtitle', 'dvb_subtitle', 'xsub']);

/** ISO 639-1/639-2 tags (both 639-2 forms) of the languages the apps label. */
const LANGUAGE_BY_TAG: Record<string, string> = {
  vi: 'vi',
  vie: 'vi',
  en: 'en',
  eng: 'en',
  zh: 'zh',
  chi: 'zh',
  zho: 'zh',
  ja: 'ja',
  jpn: 'ja',
  ko: 'ko',
  kor: 'ko',
  fr: 'fr',
  fra: 'fr',
  fre: 'fr',
};

/** Stream titles editors write when they leave the language tag empty. */
const LANGUAGE_BY_TITLE: Record<string, string> = {
  vietnamese: 'vi',
  'tiếng việt': 'vi',
  english: 'en',
  'tiếng anh': 'en',
  chinese: 'zh',
  中文: 'zh',
  japanese: 'ja',
  日本語: 'ja',
  korean: 'ko',
  한국어: 'ko',
  french: 'fr',
  français: 'fr',
};

const DEFAULT_LANGUAGE = 'vi';

/** The app language of a stream: its tag when set, else its title; undefined when neither names a known one. */
export function languageOf(stream: Pick<SubtitleStream, 'language' | 'title'>): string | undefined {
  const tag = stream.language?.trim().toLowerCase().split(/[-_]/)[0];
  if (tag && tag !== 'und') return LANGUAGE_BY_TAG[tag];
  const title = stream.title?.trim().toLowerCase();
  return title ? (LANGUAGE_BY_TITLE[title] ?? LANGUAGE_BY_TAG[title]) : undefined;
}

/**
 * Which subtitle streams become tracks: text-based ones in a known language, the first stream of
 * each language only. Vietnamese is the default track when there is one; otherwise none is.
 */
export function planSubtitles(streams: SubtitleStream[]): SubtitlePlan {
  const tracks: SubtitleTrackPlan[] = [];
  const skipped: string[] = [];
  for (const stream of streams) {
    const name = `subtitle stream ${stream.position} (${stream.codec ?? 'unknown codec'})`;
    const language = languageOf(stream);
    if (stream.codec && IMAGE_CODECS.has(stream.codec)) {
      skipped.push(`${name}: image-based subtitles cannot become WebVTT`);
    } else if (!language) {
      skipped.push(`${name}: unknown language "${stream.language ?? ''}" / title "${stream.title ?? ''}"`);
    } else if (tracks.some((track) => track.language === language)) {
      skipped.push(`${name}: a "${language}" track is already kept`);
    } else {
      tracks.push({ position: stream.position, language, isDefault: language === DEFAULT_LANGUAGE });
    }
  }
  return { tracks, skipped };
}

/** A WebVTT file players can read: the WEBVTT header and at least one cue. */
export function isWebVtt(text: string): boolean {
  return /^\uFEFF?WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(text) && text.includes('-->');
}
