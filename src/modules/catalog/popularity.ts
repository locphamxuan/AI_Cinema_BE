/**
 * Popularity = plays (or watch time) and hearts, each scaled to the most popular movie first, then mixed.
 * Adding the raw numbers would let watch seconds drown the hearts; scaling each part keeps both counting.
 */
export const POPULARITY_WEIGHTS = { views: 0.7, likes: 0.3 } as const;

export type PopularityInput = { id: string; views: number; likes: number };

/** 0..1 per movie id. A platform with no plays and no hearts yet scores every movie 0. */
export function blendPopularity(rows: PopularityInput[]): Map<string, number> {
  const maxViews = Math.max(0, ...rows.map((row) => row.views));
  const maxLikes = Math.max(0, ...rows.map((row) => row.likes));
  const part = (value: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, value) / max) : 0);
  return new Map(
    rows.map((row) => [
      row.id,
      POPULARITY_WEIGHTS.views * part(row.views, maxViews) + POPULARITY_WEIGHTS.likes * part(row.likes, maxLikes),
    ]),
  );
}
