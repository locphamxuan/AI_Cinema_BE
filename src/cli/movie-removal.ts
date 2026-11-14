import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Deletes a movie with its project and everything under it. Rows that point at it with onDelete: Restrict go
 * first, children before parents; episodes return to DRAFT so the BR-19 trigger lets their approved version go.
 * Run it inside a transaction. A movie members already paid Coins for is refused: its episode_access rows
 * would cascade away without the BR-52 refund, so take such a movie down through unpublish instead.
 */
export async function removeMovie(tx: Tx, movieId: string): Promise<void> {
  const paid = await tx.episodeAccess.count({ where: { episode: { movieId }, coinTransactionId: { not: null } } });
  if (paid > 0) throw new Error(`Movie ${movieId} has ${paid} paid unlock(s); unpublish it (BR-52 refund) instead`);
  // Rows that point at the movie with onDelete: Restrict go first, children before parents.
  const media = { mediaAsset: { episode: { movieId: movieId } } };
  await tx.streamingSession.deleteMany({ where: media });
  await tx.studioMilestoneEvent.deleteMany({ where: { OR: [media, { handoff: { projectId: movieId } }] } });
  await tx.publication.deleteMany({ where: { episode: { movieId: movieId } } });
  await tx.contentReview.deleteMany({ where: media });
  await tx.aiContentLabel.deleteMany({ where: media });
  await tx.complianceCheck.deleteMany({ where: media });
  // BR-19 trigger: a released episode must keep an approved version, so the episode goes back to DRAFT first.
  await tx.episode.updateMany({
    where: { movieId: movieId },
    data: { approvedMediaAssetId: null, status: 'DRAFT' },
  });
  await tx.mediaAsset.deleteMany({ where: { episode: { movieId: movieId } } });
  await tx.productionCostEntry.deleteMany({ where: { projectId: movieId } });
  await tx.studioHandoff.deleteMany({ where: { projectId: movieId } });
  await tx.auditLog.deleteMany({ where: { projectId: movieId } });
  await tx.movie.delete({ where: { id: movieId } });
}
