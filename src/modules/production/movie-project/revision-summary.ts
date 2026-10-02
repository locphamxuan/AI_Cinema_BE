/**
 * BR-56: the episodes taken down to be fixed, by season ("fixing 2 episodes — season 1: 3;
 * season 2: 1"). Derived from the episodes, never stored on the project status.
 */
export function revisionSummary(
  seasons: { seasonNumber: number; episodes: { episodeNumber: number; revisionStartedAt: Date | null }[] }[],
) {
  const bySeason = seasons
    .map((season) => ({
      seasonNumber: season.seasonNumber,
      episodeNumbers: season.episodes.filter((e) => e.revisionStartedAt).map((e) => e.episodeNumber),
    }))
    .filter((season) => season.episodeNumbers.length > 0);
  return { episodeCount: bySeason.reduce((sum, s) => sum + s.episodeNumbers.length, 0), bySeason };
}
