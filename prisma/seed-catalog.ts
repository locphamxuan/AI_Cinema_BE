/**
 * Puts the team's AI films (AI_Film/CATALOG.json, written by `npm run film:catalog`) into the catalog as released
 * movies, without going through the MF-1 workflow: each episode gets an approved version (played straight from
 * R2), its AI label, the four compliance items, a Coin price and a publication, so the database gates accept it.
 * A genre the genres table does not have yet is added. Idempotent: a movie whose title exists is left alone.
 * Run after `prisma db seed`.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

interface CatalogSubtitle {
  language: string;
  url: string;
  isDefault: boolean;
}

interface CatalogEpisode {
  number: number;
  subtitles?: CatalogSubtitle[];
  title: string;
  file: string;
  url: string;
  size: number;
  duration: number;
  width: number | null;
  height: number | null;
}

interface CatalogMovie {
  title: string;
  slug: string;
  genres: string[];
  language: string;
  releaseYear: number;
  synopsis: string;
  posterUrl: string;
  episodes: CatalogEpisode[];
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The team stands in for the studio: the films were not commissioned through MF-1. */
const CATALOG_STUDIO = { name: 'AI Cinema - phim của nhóm (AI_Film)', email: 'ai-film@aicinema.local' };
const LABEL_TEXT = 'Phim được tạo bằng trí tuệ nhân tạo (AI)';
const EPISODE_COIN_PRICE = 3;
const SOURCE_NOTE = 'Phim AI do nhóm dự án cung cấp (thư mục AI_Film), lưu trên R2.';

const POLICY_OF: Record<ComplianceCheckType, PolicyType> = {
  AI_LABEL_PRESENCE: PolicyType.AI_LABELING,
  DECREE_142_NOTICE: PolicyType.LEGAL,
  CONTENT_SAFETY: PolicyType.CONTENT_POLICY,
  REAL_PERSON_LIKENESS: PolicyType.LEGAL,
};

function readCatalog(): CatalogMovie[] {
  const file = path.join(process.cwd(), 'AI_Film', 'CATALOG.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { movies: CatalogMovie[] }).movies;
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

/** The genre ids of the names, adding the ones the table lacks (matched ignoring case). */
async function genreIds(names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const existing = await prisma.genre.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    ids.push((existing ?? (await prisma.genre.create({ data: { name } }))).id);
  }
  return [...new Set(ids)];
}

async function seedMovie(
  source: CatalogMovie,
  people: { reviewerId: string; creatorId: string },
  policies: Record<PolicyType, string>,
) {
  const genres = await genreIds(source.genres);
  const now = new Date();
  const today = new Date(now.toISOString().slice(0, 10));
  const studio = await prisma.studio.upsert({
    where: { email: CATALOG_STUDIO.email },
    update: {},
    create: { ...CATALOG_STUDIO, note: SOURCE_NOTE, createdById: people.reviewerId },
  });

  await prisma.$transaction(
    async (tx) => {
      const movie = await tx.movie.create({
        data: {
          title: source.title,
          synopsis: source.synopsis,
          ideaDescription: `${SOURCE_NOTE}\n${source.episodes.map((e) => e.file).join('\n')}`,
          defaultLanguage: source.language,
          releaseYear: source.releaseYear,
          status: MovieStatus.COMPLETED,
          posterUrl: source.posterUrl,
          bannerUrl: source.posterUrl,
          reviewerId: people.reviewerId,
          creatorId: people.creatorId,
          studioId: studio.id,
          handedOffAt: now,
          completedAt: now,
          genres: { create: genres.map((genreId) => ({ genreId })) },
        },
      });
      const season = await tx.season.create({ data: { movieId: movie.id, seasonNumber: 1, title: 'Mùa 1' } });
      for (const episode of source.episodes) {
        await seedEpisode(
          tx,
          { movieId: movie.id, seasonId: season.id, source, today, now },
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
  at: { movieId: string; seasonId: string; source: CatalogMovie; today: Date; now: Date },
  source: CatalogEpisode,
  people: { reviewerId: string; creatorId: string },
  policies: Record<PolicyType, string>,
) {
  const episode = await tx.episode.create({
    data: {
      movieId: at.movieId,
      seasonId: at.seasonId,
      episodeNumber: source.number,
      title: source.title,
      synopsis: `${at.source.title} - ${source.title}.`,
      thumbnailUrl: at.source.posterUrl,
      targetDurationSeconds: source.duration,
      deliveryDeadline: at.today,
      dueDate: at.today,
      status: EpisodeStatus.COMPLIANCE_PASSED,
    },
  });
  const asset = await tx.mediaAsset.create({
    data: {
      episodeId: episode.id,
      version: 1,
      sourceMethod: MediaSourceMethod.REMOTE_FILE,
      sourceUrl: source.url,
      streamUrl: source.url,
      isSelfHosted: true,
      qualities: source.height ? [`${source.height}p`] : [],
      durationSeconds: source.duration,
      fileSizeBytes: BigInt(source.size),
      ingestStatus: MediaIngestStatus.READY,
      aiDisclosure: {
        aiGeneratedParts: ['video', 'audio'],
        noRealPersonLikeness: true,
        noCopyrightedMaterial: true,
        source: { file: source.file },
      },
      proposedLabelType: LabelType.AI_GENERATED,
      submissionNote: SOURCE_NOTE,
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
  await attachSubtitles(tx, asset.id, source.subtitles ?? []);
}

/** One track per language on the approved version; running the seed again refreshes the URL. */
async function attachSubtitles(db: Tx | PrismaClient, mediaAssetId: string, subtitles: CatalogSubtitle[]) {
  for (const s of subtitles) {
    await db.mediaSubtitle.upsert({
      where: { mediaAssetId_language: { mediaAssetId, language: s.language } },
      update: { fileUrl: s.url, isDefault: s.isDefault },
      create: { mediaAssetId, language: s.language, fileUrl: s.url, isDefault: s.isDefault },
    });
  }
}

/** A movie seeded before its subtitles existed gets them on its released episodes. */
async function backfillSubtitles(movieId: string, source: CatalogMovie): Promise<number> {
  let added = 0;
  for (const episode of source.episodes) {
    if (!episode.subtitles?.length) continue;
    const row = await prisma.episode.findFirst({
      where: { movieId, episodeNumber: episode.number, approvedMediaAssetId: { not: null } },
      select: { approvedMediaAssetId: true },
    });
    if (!row?.approvedMediaAssetId) continue;
    await attachSubtitles(prisma, row.approvedMediaAssetId, episode.subtitles);
    added += episode.subtitles.length;
  }
  return added;
}

async function main() {
  const [reviewer, creator] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'reviewer@gmail.com' }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: 'creator.aicinema@gmail.com' }, select: { id: true } }),
  ]);
  if (!reviewer || !creator) throw new Error('Seed accounts missing: run `prisma db seed` first');
  const policies = await activePolicies();
  const catalog = readCatalog();

  let added = 0;
  for (const source of catalog) {
    const existing = await prisma.movie.findFirst({ where: { title: source.title }, select: { id: true } });
    if (existing) {
      const tracks = await backfillSubtitles(existing.id, source);
      if (tracks) console.log(`~ ${source.title}: ${tracks} subtitle track(s)`);
      continue;
    }
    await seedMovie(source, { reviewerId: reviewer.id, creatorId: creator.id }, policies);
    added += 1;
    console.log(`+ ${source.title}`);
  }
  const episodes = catalog.reduce((n, m) => n + m.episodes.length, 0);
  console.log(
    `Catalog: ${added} new movie(s); ${catalog.length} movies / ${episodes} episodes in AI_Film/CATALOG.json.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
