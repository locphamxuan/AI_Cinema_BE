import type { INestApplicationContext } from '@nestjs/common';
import { ContentReviewDecision, LabelType, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { AiLabelService } from 'src/modules/production/content-review/ai-label.service';
import { ComplianceService } from 'src/modules/production/content-review/compliance.service';
import { ContentReviewService } from 'src/modules/production/content-review/content-review.service';
import { StudioContractService } from 'src/modules/production/contract/contract-studio.service';
import { ContractService } from 'src/modules/production/contract/contract.service';
import { demoMark } from 'src/modules/production/contract/template/demo-signature';
import { ContractTemplateService } from 'src/modules/production/contract/template/contract-template.service';
import { MovieProjectService } from 'src/modules/production/movie-project/movie-project.service';
import { ProjectNoteService } from 'src/modules/production/movie-project/project-note/project-note.service';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { FinalFilmService } from 'src/modules/production/publishing/final-film.service';
import { ScriptService } from 'src/modules/production/script/script.service';
import { StudioService } from 'src/modules/production/studio/studio.service';
import { removeMovie } from '../movie-removal';
import { asUpload, inDays, loadDemoData } from './demo-data';
import { deliverFromR2 } from './deliver-from-r2';

/**
 * MF-1 demo: one project per milestone, each built through the real services (rules, triggers, notifications)
 * from prisma/demo/mf1-demo.json and a film of the team's R2 catalogue. The contracts are the ones the system
 * generates for each project; the signed copies uploaded are those same PDFs with a demo signature drawn in, so
 * every PDF names the right film, studio and budget. Run again to rebuild it.
 * Answers what it built. Run by `npm run seed:mf1-demo` (seed-mf1-demo.main.ts).
 */
export async function seedMf1Demo(
  app: INestApplicationContext,
  { data, film }: ReturnType<typeof loadDemoData> = loadDemoData(),
): Promise<string> {
  const prisma = app.get(PrismaService);
  const as = async (email: string): Promise<AuthenticatedUser> => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, role: true, studioId: true },
    });
    return { id: user.id, role: user.role, studioId: user.studioId ?? undefined };
  };
  const [admin, reviewer, creator, studioUser] = await Promise.all(
    [data.people.admin, data.people.reviewer, data.people.creator, data.people.studio].map(as),
  );
  if (studioUser.role !== UserRole.STUDIO || !studioUser.studioId) throw new Error('Run `npx prisma db seed` first');
  const studio = { studioId: studioUser.studioId, userId: studioUser.id };

  // Step 0, done once by the Admin: the legal identity of both parties the contract is filled with.
  await app.get(PlatformSettingService).update(data.platformParty, admin.id);
  await app.get(StudioService).update(studio.studioId, data.studioProfile, admin);

  for (const old of await prisma.movie.findMany({
    where: { title: { startsWith: data.prefix } },
    select: { id: true },
  })) {
    await prisma.$transaction((tx) => removeMovie(tx, old.id));
  }
  const by = { admin, reviewer, creator, studio, studioUser };
  for (const [index, stage] of data.stages.entries()) await buildStage(app, index, stage, { data, film, by });
  return `MF-1 demo ready: ${data.stages.length} projects "${data.prefix} …" built from "${film.title}".`;
}

type Demo = ReturnType<typeof loadDemoData> & {
  by: {
    admin: AuthenticatedUser;
    reviewer: AuthenticatedUser;
    creator: AuthenticatedUser;
    studio: { studioId: string; userId: string };
    studioUser: AuthenticatedUser;
  };
};

/** Project N walks MF-1 up to milestone N and stops there. */
async function buildStage(app: INestApplicationContext, index: number, [stage, summary]: [string, string], demo: Demo) {
  const { data, film, by } = demo;
  const { project: p } = data;
  const prisma = app.get(PrismaService);
  const created = (await app.get(MovieProjectService).create(
    {
      title: `${data.prefix} ${film.title} - ${stage}`,
      ideaDescription: `${summary}\n${film.synopsis}`,
      genreNames: film.genres.slice(0, 3),
      synopsis: film.synopsis,
      ageRating: p.ageRating,
      studioId: by.studio.studioId,
      reviewerId: by.reviewer.id,
      creatorId: by.creator.id,
      seasons: [
        {
          title: 'Mùa 1',
          releaseStartDate: inDays(p.releaseStartInDays),
          releaseEndDate: inDays(p.releaseEndInDays),
          episodes: film.episodes.slice(0, p.episodeCount).map((e, i) => ({
            title: e.title,
            targetDurationSeconds: Math.max(60, Math.round(e.duration)),
            deliveryDeadline: inDays(p.firstDeadlineInDays + i * p.daysBetweenDeadlines),
          })),
        },
      ],
    } as never,
    by.admin,
  )) as { id: string };
  const projectId = created.id;
  await app
    .get(ProductionCostService)
    .addEntry(projectId, { entryType: 'BUDGET', amountVnd: p.budgetVnd, reason: p.budgetReason } as never, by.admin);
  for (const [who, text] of p.notes) await app.get(ProjectNoteService).send(projectId, text, by[who]);
  const scripts = app.get(ScriptService);
  await scripts.submit(
    projectId,
    { content: `Kịch bản "${film.title}"\n\n${film.synopsis}`, note: p.scriptNote },
    by.creator,
  );
  if (index === 0) return;

  await scripts.review(projectId, { approve: true, comment: p.reviewComment }, by.reviewer);
  // Approving the Final Script sends the studio its unsigned contract, priced at the budget ceiling.
  await scripts.finalReview(projectId, { approve: true, comment: p.finalComment }, by.admin);
  if (index === 1) return;

  const templates = app.get(ContractTemplateService);
  const sent = await prisma.contract.findFirstOrThrow({ where: { projectId }, orderBy: { round: 'desc' } });
  const studioCopy = await templates.signedCopy(sent.id, [demoMark('STUDIO')]);
  await app
    .get(StudioContractService)
    .propose(sent.id, undefined, by.studio, asUpload(studioCopy, 'hop-dong-studio-da-ky.pdf'));
  if (index === 2) return;

  const bothSigned = await templates.signedCopy(sent.id, [demoMark('STUDIO'), demoMark('ADMIN')]);
  await app.get(ContractService).sign(sent.id, by.admin, asUpload(bothSigned, 'hop-dong-admin-da-ky.pdf'));
  if (index === 3) return;

  const episode = await prisma.episode.findFirstOrThrow({ where: { movieId: projectId, episodeNumber: 1 } });
  const asset = await deliverFromR2(prisma, {
    episodeId: episode.id,
    studioUserId: by.studio.userId,
    source: film.episodes[0],
    note: p.deliveryNote,
  });
  if (index === 4) return;

  await app.get(ContentReviewService).review(asset, { decision: ContentReviewDecision.APPROVED }, by.reviewer);
  await app
    .get(AiLabelService)
    .apply(asset, { labelType: LabelType.AI_GENERATED, labelText: p.aiLabelText }, by.reviewer);
  await app.get(ComplianceService).run(
    asset,
    {
      decree142Notice: { result: 'PASS' },
      contentSafety: { result: 'PASS' },
      depictsRealPersonOrEvent: false,
    } as never,
    by.reviewer,
  );
  await app.get(FinalFilmService).confirm(episode.id, by.reviewer);
}
