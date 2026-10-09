/**
 * Puts the AI films of catalog-sources.ts into the catalog as released movies, without going through the
 * MF-1 workflow: each episode gets an approved version (played straight from Wikimedia Commons), its AI
 * label, the four compliance items, a Coin price and a publication, so the database gates accept it.
 * Idempotent: a movie whose title already exists is left alone. Run after `prisma db seed`.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ComplianceCheckType,
  ContentReviewDecision,
  EpisodeStatus,
  LabelType,
  MediaIngestStatus,
  MediaSourceMethod,
  MovieStatus,
  PolicyType,
  PrismaClient,
} from '@prisma/client';
import { CATALOG_SOURCES, type CatalogEpisodeSource, type CatalogMovieSource } from './catalog-sources';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The source stands in for the studio: the films were not commissioned. */
const SOURCE_STUDIO = { studioName: 'Wikimedia Commons (nguồn mở)', studioEmail: 'catalog-sources@aicinema.local' };
const LABEL_TEXT = 'Phim được tạo bằng trí tuệ nhân tạo (AI)';
const EPISODE_COIN_PRICE = 3;

const POLICY_OF: Record<ComplianceCheckType, PolicyType> = {
  AI_LABEL_PRESENCE: PolicyType.AI_LABELING,
  DECREE_142_NOTICE: PolicyType.LEGAL,
  CONTENT_SAFETY: PolicyType.CONTENT_POLICY,
  REAL_PERSON_LIKENESS: PolicyType.LEGAL,
};

/** Attribution as CC BY asks: author, licence and source. */
function credit(e: CatalogEpisodeSource): string {
  return `"${e.title}" — ${e.artist}. ${e.license}${e.licenseUrl ? ` (${e.licenseUrl})` : ''}. Nguồn: ${e.page}`;
}

async function activePolicies(): Promise<Record<PolicyType, string>> {
  const policies = await prisma.policy.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
  const byType = {} as Record<PolicyType, string>;
  for (const p of policies) byType[p.type] ??= p.id;
  for (const type of new Set(Object.values(POLICY_OF))) {
    if (!byType[type]) throw new Error(`No active ${type} policy: run \`prisma db seed\` first`);
  }
  return byType;
}

async function seedMovie(
  source: CatalogMovieSource,
  people: { reviewerId: string; creatorId: string },
  policies: Record<PolicyType, string>,
) {
  const genres = await prisma.genre.findMany({ where: { name: { in: source.genres } }, select: { id: true } });
  const now = new Date();
  const today = new Date(now.toISOString().slice(0, 10));

  await prisma.$transaction(
    async (tx) => {
      const movie = await tx.movie.create({
        data: {
          title: source.title,
          synopsis: source.synopsis,
          ideaDescription: [
            'Phim AI có sẵn, đưa vào catalog từ nguồn mở (không đặt studio sản xuất).',
            ...source.episodes.map(credit),
          ].join('\n'),
          defaultLanguage: source.title.startsWith('Le Temple') ? 'fr' : 'vi',
          ageRating: source.ageRating,
          releaseYear: source.releaseYear,
          status: MovieStatus.COMPLETED,
          posterUrl: source.episodes[0].thumb,
          bannerUrl: source.episodes[0].thumb,
          reviewerId: people.reviewerId,
          creatorId: people.creatorId,
          ...SOURCE_STUDIO,
          assignedAt: now,
          handedOffAt: now,
          completedAt: now,
          genres: { create: genres.map(({ id }) => ({ genreId: id })) },
        },
      });
      const season = await tx.season.create({ data: { movieId: movie.id, seasonNumber: 1, title: 'Mùa 1' } });
      for (const [index, episode] of source.episodes.entries()) {
        await seedEpisode(
          tx,
          { movieId: movie.id, seasonId: season.id, episodeNumber: index + 1, today, now },
          episode,
          people,
          policies,
        );
      }
      // A remote database (Neon) needs more than the 5 s default for a movie with many episodes.
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

async function seedEpisode(
  tx: Tx,
  at: { movieId: string; seasonId: string; episodeNumber: number; today: Date; now: Date },
  source: CatalogEpisodeSource,
  people: { reviewerId: string; creatorId: string },
  policies: Record<PolicyType, string>,
) {
  const episode = await tx.episode.create({
    data: {
      movieId: at.movieId,
      seasonId: at.seasonId,
      episodeNumber: at.episodeNumber,
      title: source.title,
      synopsis: `${source.synopsis}\n\n${credit(source)}`,
      thumbnailUrl: source.thumb,
      targetDurationSeconds: source.duration,
      milestoneDate: at.today,
      dueDate: at.today,
      status: EpisodeStatus.COMPLIANCE_PASSED,
    },
  });
  // Played straight from Commons: no copy in our storage, so not self-hosted.
  const asset = await tx.mediaAsset.create({
    data: {
      episodeId: episode.id,
      version: 1,
      sourceMethod: MediaSourceMethod.REMOTE_FILE,
      sourceUrl: source.url,
      streamUrl: source.url,
      isSelfHosted: false,
      qualities: [`${source.height}p`],
      durationSeconds: source.duration,
      fileSizeBytes: BigInt(source.size),
      ingestStatus: MediaIngestStatus.READY,
      aiDisclosure: {
        aiTools: source.aiTools,
        aiGeneratedParts: ['video'],
        humanEdited: true,
        noRealPersonLikeness: true,
        noCopyrightedMaterial: true,
        source: { file: source.file, page: source.page, license: source.license, author: source.artist },
      },
      proposedLabelType: LabelType.AI_GENERATED,
      submissionNote: credit(source),
      submittedById: people.creatorId,
    },
  });
  await tx.contentReview.create({
    data: { mediaAssetId: asset.id, reviewerId: people.reviewerId, decision: ContentReviewDecision.APPROVED },
  });
  await tx.aiContentLabel.create({
    data: {
      mediaAssetId: asset.id,
      labelType: LabelType.AI_GENERATED,
      labelText: LABEL_TEXT,
      appliedById: people.reviewerId,
      policyId: policies[PolicyType.AI_LABELING],
    },
  });
  await tx.complianceCheck.createMany({
    data: Object.values(ComplianceCheckType).map((checkType) => ({
      mediaAssetId: asset.id,
      checkType,
      result: 'PASS' as const,
      checkedById: people.reviewerId,
      checkedAt: at.now,
      policyId: policies[POLICY_OF[checkType]],
    })),
  });
  // The database gate checks the label, the four items and the price as the episode goes live.
  await tx.episode.update({
    where: { id: episode.id },
    data: { approvedMediaAssetId: asset.id, coinPrice: EPISODE_COIN_PRICE, status: EpisodeStatus.PUBLISHED },
  });
  await tx.publication.create({
    data: { episodeId: episode.id, mediaAssetId: asset.id, publishedAt: at.now, publishedById: people.reviewerId },
  });
}

async function main() {
  const [reviewer, creator] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'reviewer01@aicinema.com' }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: 'creator01@aicinema.com' }, select: { id: true } }),
  ]);
  if (!reviewer || !creator) throw new Error('Seed accounts missing: run `prisma db seed` first');
  const policies = await activePolicies();

  let added = 0;
  for (const source of CATALOG_SOURCES) {
    if (await prisma.movie.findFirst({ where: { title: source.title }, select: { id: true } })) continue;
    await seedMovie(source, { reviewerId: reviewer.id, creatorId: creator.id }, policies);
    added += 1;
  }
  const episodes = CATALOG_SOURCES.reduce((n, m) => n + m.episodes.length, 0);
  console.log(
    `Catalog: ${added} new movie(s); ${CATALOG_SOURCES.length} movies / ${episodes} episodes in the source list.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
