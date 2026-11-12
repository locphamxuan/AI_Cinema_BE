import 'dotenv/config';
// Background jobs and outgoing mail stay off while the demo is built: no sweeps, no real email to the studio.
process.env.REDIS_URL = '';
process.env.SMTP_HOST = '';
process.env.MEDIA_PIPELINE = 'mock';
for (const job of ['PUBLICATION_SWEEP_MS', 'OVERDUE_SWEEP_MS', 'HLS_CHECK_MS', 'STREAMING_SESSION_SWEEP_MS']) {
  process.env[job] = '0';
}
process.env.STREAMING_SESSION_RETENTION_SWEEP_MS = '0';
process.env.SUPPORT_AUTO_CLOSE_SWEEP_MS = '0';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  ContentReviewDecision,
  EpisodeStatus,
  LabelType,
  MediaIngestStatus,
  MediaSourceMethod,
  UserRole,
  type PrismaClient,
} from '@prisma/client';
import { AppModule } from 'src/app.module';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AiLabelService } from 'src/modules/production/content-review/ai-label.service';
import { ComplianceService } from 'src/modules/production/content-review/compliance.service';
import { ContentReviewService } from 'src/modules/production/content-review/content-review.service';
import { ContractService } from 'src/modules/production/contract/contract.service';
import { StudioContractService } from 'src/modules/production/contract/contract-studio.service';
import { MovieProjectService } from 'src/modules/production/movie-project/movie-project.service';
import { ProjectNoteService } from 'src/modules/production/movie-project/project-note/project-note.service';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { FinalFilmService } from 'src/modules/production/publishing/final-film.service';
import { ScriptService } from 'src/modules/production/script/script.service';
import { removeMovie } from './movie-removal';

/**
 * MF-1 demo (12/11/2026): five projects, each stopped at one milestone so the flow can be shown step by step.
 * Built through the real services (rules, triggers, notifications), with the team's R2 films as the delivered
 * media and the sample contract PDFs as the signed counterparts. Run again to rebuild it.
 *   npm run seed:mf1-demo   (builds first: Nest DI needs decorator metadata, which tsx does not emit)
 */
const PREFIX = '[Demo MF-1]';
const PEOPLE = {
  admin: 'admin@aicinema.com',
  reviewer: 'reviewer@gmail.com',
  creator: 'creator.aicinema@gmail.com',
  studio: 'studio@aicinema.com',
};
const BUDGET_VND = 200_000_000;
const COST_VND = 170_000_000;
const PDF_DIR = join(process.cwd(), 'docs', 'contracts');
const pdf = (name: string) =>
  ({
    buffer: readFileSync(join(PDF_DIR, name)),
    originalname: name,
    mimetype: 'application/pdf',
  }) as Express.Multer.File;

type CatalogEpisode = { number: number; title: string; url: string; size: number; duration: number; height?: number };
type Catalog = { movies: { title: string; genres: string[]; synopsis: string; episodes: CatalogEpisode[] }[] };
const catalog = JSON.parse(readFileSync(join(process.cwd(), 'AI_Film', 'CATALOG.json'), 'utf8')) as Catalog;
const SOURCE = catalog.movies.find((m) => m.episodes.length >= 3) ?? catalog.movies[0];

const STAGES = [
  ['1. Viết kịch bản', 'Creator đã nộp kịch bản bản 1, chờ Reviewer duyệt.'],
  ['2. Hợp đồng', 'Admin đã duyệt Kịch bản Final, hệ thống gửi hợp đồng mẫu cho Studio.'],
  ['3. Giao phim', 'Hợp đồng đủ 2 chữ ký PDF, Studio đang sản xuất, chờ giao tập.'],
  ['4. Duyệt nội dung', 'Studio đã giao tập 1 (phim trên R2), chờ Reviewer duyệt, gắn nhãn AI, kiểm tra tuân thủ.'],
  ['5. Định giá & phát hành', 'Reviewer đã xác nhận Final Film tập 1, chờ Admin đặt giá, tập khoá / mở và publish.'],
] as const;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const as = async (email: string): Promise<AuthenticatedUser & { studioId: string | null }> => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, role: true, studioId: true },
    });
    return user;
  };
  const [admin, reviewer, creator, studioUser] = await Promise.all(Object.values(PEOPLE).map(as));
  if (studioUser.role !== UserRole.STUDIO || !studioUser.studioId)
    throw new Error('Run `npx prisma db seed` first (demo studio)');
  const studio = { studioId: studioUser.studioId, userId: studioUser.id };

  for (const old of await prisma.movie.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } })) {
    await prisma.$transaction((tx) => removeMovie(tx, old.id));
  }

  const projects = app.get(MovieProjectService);
  const scripts = app.get(ScriptService);
  const notes = app.get(ProjectNoteService);
  const costs = app.get(ProductionCostService);
  const contracts = app.get(ContractService);
  const studioContracts = app.get(StudioContractService);

  for (const [index, [stage, summary]] of STAGES.entries()) {
    const created = await projects.create(
      {
        title: `${PREFIX} ${SOURCE.title} — ${stage}`,
        ideaDescription: `${summary}\n${SOURCE.synopsis}`,
        genreNames: SOURCE.genres.slice(0, 3),
        synopsis: SOURCE.synopsis,
        ageRating: 'T16',
        studioId: studio.studioId,
        reviewerId: reviewer.id,
        creatorId: creator.id,
        seasons: [
          {
            title: 'Mùa 1',
            releaseStartDate: inDays(30),
            releaseEndDate: inDays(90),
            episodes: SOURCE.episodes.slice(0, 3).map((e, i) => ({
              title: e.title,
              targetDurationSeconds: Math.max(60, Math.round(e.duration)),
              deliveryDeadline: inDays(14 + i * 7),
            })),
          },
        ],
      } as never,
      admin,
    );
    const projectId = (created as { id: string }).id;
    await notes.send(projectId, 'Admin: phim giữ tông lãng mạn nhẹ nhàng, 3 tập ngắn cho mobile.', admin);
    await notes.send(projectId, 'Creator: đồng ý, bản kịch bản đầu tiên sẽ có trong tuần này.', creator);
    await scripts.submit(
      projectId,
      { content: `Kịch bản "${SOURCE.title}"\n\n${SOURCE.synopsis}`, note: 'Bản 1' },
      creator,
    );
    if (index === 0) continue;

    await scripts.review(projectId, { approve: true, comment: 'Kịch bản ổn, chuyển Admin duyệt Final.' }, reviewer);
    await costs.addEntry(
      projectId,
      { entryType: 'BUDGET', amountVnd: BUDGET_VND, reason: 'Ngân sách demo' } as never,
      admin,
    );
    await scripts.finalReview(projectId, { approve: true, comment: 'Duyệt Kịch bản Final.' }, admin);
    if (index === 1) continue;

    // Admin signs first on the template with its PDF, the studio signs the same price with its own PDF.
    const template = await prisma.contract.findFirstOrThrow({ where: { projectId }, orderBy: { round: 'desc' } });
    const offer = await contracts.counter(template.id, COST_VND, admin, pdf('hop-dong-ai-cinema-ban-ky-admin.pdf'));
    await studioContracts.studioSign(offer.id, studio, pdf('hop-dong-ai-cinema-ban-ky-studio.pdf'));
    if (index === 2) continue;

    const episode = await prisma.episode.findFirstOrThrow({ where: { movieId: projectId, episodeNumber: 1 } });
    const asset = await deliverFromR2(prisma, episode.id, studio.userId, SOURCE.episodes[0]);
    if (index === 3) continue;

    await app.get(ContentReviewService).review(asset, { decision: ContentReviewDecision.APPROVED }, reviewer);
    await app
      .get(AiLabelService)
      .apply(asset, { labelType: LabelType.AI_GENERATED, labelText: 'Nội dung do AI tạo' }, reviewer);
    await app.get(ComplianceService).run(
      asset,
      {
        decree142Notice: { result: 'PASS' },
        contentSafety: { result: 'PASS' },
        depictsRealPersonOrEvent: false,
      } as never,
      reviewer,
    );
    await app.get(FinalFilmService).confirm(episode.id, reviewer);
  }
  console.log(`MF-1 demo ready: ${STAGES.length} projects "${PREFIX} …" built from "${SOURCE.title}".`);
  await app.close();
}

/** The studio delivers episode 1 as the team's R2 file, already playable (no transcoding in the demo). */
async function deliverFromR2(prisma: PrismaClient, episodeId: string, studioUserId: string, source: CatalogEpisode) {
  const asset = await prisma.mediaAsset.create({
    data: {
      episodeId,
      version: 1,
      sourceMethod: MediaSourceMethod.REMOTE_FILE,
      sourceUrl: source.url,
      streamUrl: source.url,
      isSelfHosted: true,
      qualities: source.height ? [`${source.height}p`] : [],
      durationSeconds: Math.round(source.duration),
      fileSizeBytes: BigInt(source.size),
      ingestStatus: MediaIngestStatus.READY,
      aiDisclosure: { aiGeneratedParts: ['video', 'audio'], noRealPersonLikeness: true, noCopyrightedMaterial: true },
      proposedLabelType: LabelType.AI_GENERATED,
      submissionNote: 'Studio giao tập 1 bằng link phim trên R2 (demo).',
      submittedById: studioUserId,
    },
  });
  await prisma.episode.update({ where: { id: episodeId }, data: { status: EpisodeStatus.IN_REVIEW } });
  return asset.id;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
