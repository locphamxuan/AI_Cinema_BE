/**
 * BR-68 — the member's taste read from what they actually do, not only from what they opened:
 * a movie watched to the end counts fully, one dropped half-way a little, and one left in the
 * first minutes counts *against* its genres and country.
 */
export type Engagement = 'LIKED' | 'FINISHED' | 'ENGAGED' | 'DROPPED' | 'BOUNCED';

export const ENGAGEMENT_WEIGHT: Record<Engagement, number> = {
  LIKED: 1,
  FINISHED: 1,
  ENGAGED: 0.6,
  DROPPED: 0.15,
  BOUNCED: -0.5,
};

/** Share of an episode watched at or above which the episode counts as seen through. */
const FINISHED_RATIO = 0.85;
const ENGAGED_RATIO = 0.5;
/** Below this share of the first episode the member left right away. */
const BOUNCE_RATIO = 0.2;

export type TasteMovie = { id: string; country: string | null; genres: { genre: { name: string } }[] };

export type ProgressRow = {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  episode: { targetDurationSeconds: number; movie: TasteMovie };
};

export type Taste = {
  /** Movies the member already opened or liked: never suggested again. */
  seen: Set<string>;
  behaviors: Map<string, Engagement>;
  genre: Map<string, number>;
  country: Map<string, number>;
  /** Sum of the positive weights: the scale affinities are measured against. */
  positiveGenre: number;
  positiveCountry: number;
};

const ratioOf = (row: ProgressRow): number => {
  if (row.completed) return 1;
  const duration = row.durationSeconds ?? row.episode.targetDurationSeconds;
  return duration > 0 ? Math.min(1, Math.max(0, row.positionSeconds / duration)) : 0;
};

/** How the member watched one movie, from the progress rows of its episodes. */
export function engagementOf(rows: ProgressRow[]): Engagement {
  const ratios = rows.map(ratioOf);
  const average = ratios.reduce((sum, r) => sum + r, 0) / Math.max(1, ratios.length);
  const completed = rows.filter((row) => row.completed).length;
  if (completed && average >= FINISHED_RATIO) return 'FINISHED';
  if (completed || rows.length >= 2 || average >= ENGAGED_RATIO) return 'ENGAGED';
  if (Math.max(0, ...ratios) >= BOUNCE_RATIO) return 'DROPPED';
  return 'BOUNCED';
}

export function buildTaste(likes: TasteMovie[], progress: ProgressRow[]): Taste {
  const byMovie = new Map<string, { movie: TasteMovie; rows: ProgressRow[] }>();
  for (const row of progress) {
    const entry = byMovie.get(row.episode.movie.id) ?? { movie: row.episode.movie, rows: [] };
    entry.rows.push(row);
    byMovie.set(row.episode.movie.id, entry);
  }
  const behaviors = new Map<string, Engagement>();
  const movies = new Map<string, TasteMovie>();
  for (const { movie, rows } of byMovie.values()) {
    behaviors.set(movie.id, engagementOf(rows));
    movies.set(movie.id, movie);
  }
  // A like outweighs a bounce: the member said they want this kind of movie.
  for (const movie of likes) {
    behaviors.set(movie.id, 'LIKED');
    movies.set(movie.id, movie);
  }

  const taste: Taste = {
    seen: new Set(movies.keys()),
    behaviors,
    genre: new Map(),
    country: new Map(),
    positiveGenre: 0,
    positiveCountry: 0,
  };
  for (const [id, movie] of movies) {
    const weight = ENGAGEMENT_WEIGHT[behaviors.get(id)!];
    for (const { genre } of movie.genres) taste.genre.set(genre.name, (taste.genre.get(genre.name) ?? 0) + weight);
    if (movie.country) taste.country.set(movie.country, (taste.country.get(movie.country) ?? 0) + weight);
  }
  taste.positiveGenre = [...taste.genre.values()].filter((w) => w > 0).reduce((a, b) => a + b, 0);
  taste.positiveCountry = [...taste.country.values()].filter((w) => w > 0).reduce((a, b) => a + b, 0);
  return taste;
}

const clamp = (value: number) => Math.min(1, Math.max(-1, value));

/** -1..1: the best-liked genre of the movie, pulled down by a genre the member keeps leaving. */
export function genreAffinity(movie: TasteMovie, taste: Taste): number {
  if (!taste.positiveGenre) return 0;
  const weights = movie.genres.map(({ genre }) => taste.genre.get(genre.name) ?? 0);
  const best = Math.max(0, ...weights);
  const worst = Math.min(0, ...weights);
  return clamp((best + worst) / taste.positiveGenre);
}

export function countryAffinity(movie: TasteMovie, taste: Taste): number {
  if (!movie.country || !taste.positiveCountry) return 0;
  return clamp((taste.country.get(movie.country) ?? 0) / taste.positiveCountry);
}

export const TRENDING_REASON = 'Đang thịnh hành trên AI Cinema';

/** The strongest taste signal the movie matches, in words the Member reads under the poster. */
export function reasonFor(movie: TasteMovie, taste: Taste): string {
  const genre = movie.genres
    .map(({ genre }) => ({ name: genre.name, weight: taste.genre.get(genre.name) ?? 0 }))
    .sort((a, b) => b.weight - a.weight)[0];
  if (genre && genre.weight > 0) return `Hợp gu ${genre.name} bạn hay xem hết`;
  if (movie.country && (taste.country.get(movie.country) ?? 0) > 0) return `Phim ${movie.country} bạn hay xem`;
  return TRENDING_REASON;
}

/** Genres two movies share, and the Jaccard overlap 0..1. */
export function genreOverlap(a: TasteMovie, b: TasteMovie): { shared: string[]; overlap: number } {
  const left = new Set(a.genres.map(({ genre }) => genre.name));
  const right = b.genres.map(({ genre }) => genre.name);
  const shared = right.filter((name) => left.has(name));
  const union = new Set([...left, ...right]).size;
  return { shared, overlap: union ? shared.length / union : 0 };
}
