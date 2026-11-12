import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Keeps only the team's AI films loaded from R2 by `seed-catalog.ts` (their project belongs to the catalog studio)
 * and deletes every other movie with its project, seasons, episodes and what hangs off them (cascade).
 * Dry run by default: `npm run seed:prune-movies` lists what would go; add `-- --apply` to delete.
 */
const CATALOG_STUDIO_EMAIL = 'ai-film@aicinema.local';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const doomed = await prisma.movie.findMany({
    where: {
      OR: [
        { project: null },
        { project: { studio: { is: null } } },
        { project: { studio: { email: { not: CATALOG_STUDIO_EMAIL } } } },
      ],
    },
    select: {
      id: true,
      title: true,
      project: { select: { status: true } },
      _count: { select: { episodes: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const kept = await prisma.movie.count({ where: { project: { studio: { email: CATALOG_STUDIO_EMAIL } } } });
  console.log(`R2 catalog movies kept: ${kept}. Other movies: ${doomed.length}.`);
  for (const movie of doomed) {
    console.log(`  - ${movie.title} (${movie.project?.status ?? 'no project'}, ${movie._count.episodes} episodes)`);
  }
  if (!apply) {
    console.log('Dry run: nothing deleted. Run again with --apply to delete the movies above.');
    return;
  }
  let deleted = 0;
  for (const movie of doomed) {
    try {
      await prisma.$transaction(async (tx) => {
        // Rows that point at the movie with onDelete: Restrict go first, children before parents.
        const media = { mediaAsset: { episode: { movieId: movie.id } } };
        await tx.streamingSession.deleteMany({ where: media });
        await tx.studioMilestoneEvent.deleteMany({ where: { OR: [media, { handoff: { projectId: movie.id } }] } });
        await tx.publication.deleteMany({ where: { episode: { movieId: movie.id } } });
        await tx.contentReview.deleteMany({ where: media });
        await tx.aiContentLabel.deleteMany({ where: media });
        await tx.complianceCheck.deleteMany({ where: media });
        // BR-19 trigger: a released episode must keep an approved version, so the episode goes back to DRAFT first.
        await tx.episode.updateMany({
          where: { movieId: movie.id },
          data: { approvedMediaAssetId: null, status: 'DRAFT' },
        });
        await tx.mediaAsset.deleteMany({ where: { episode: { movieId: movie.id } } });
        await tx.productionCostEntry.deleteMany({ where: { projectId: movie.id } });
        await tx.studioHandoff.deleteMany({ where: { projectId: movie.id } });
        await tx.auditLog.deleteMany({ where: { projectId: movie.id } });
        await tx.movie.delete({ where: { id: movie.id } });
      });
      deleted += 1;
    } catch (error) {
      console.error(`  ! could not delete "${movie.title}": ${(error as Error).message.split('\n').pop()}`);
    }
  }
  console.log(`Deleted ${deleted} of ${doomed.length} movies.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
