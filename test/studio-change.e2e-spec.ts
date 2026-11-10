import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { adminSign, proposeCost } from './support/contracts';
import { DISCLOSURE, MP4 } from './support/media';
import { newStudio, projectInProduction, type ProjectDetail, studioAccount, studioOf } from './support/projects';

interface Contract extends Row {
  studioId: string;
  round: number;
  status: string;
  costVnd: number | null;
  handoffId: string | null;
}

interface Handoff extends Row {
  milestoneStatus: string;
  offeredFeeVnd: number;
  studio: { id: string; name: string };
  contracts: { id: string; round: number; status: string; costVnd: number | null }[];
}

const FILM = { field: 'file', name: 'tap.mp4', content: MP4 };
const FILM_FIELDS = { aiDisclosure: JSON.stringify(DISCLOSURE), proposedLabelType: 'AI_GENERATED' };
const FEE_B = 50_000_000;
const FEE_C = 45_000_000;

/**
 * BR-59 studio change under MF-1 contracts: the new studio gets its own contract and only starts producing once
 * both sides signed it; whatever the replaced studio still had under negotiation is superseded.
 */
describe('Studio change with a new contract (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let project: ProjectDetail;
  let studioB: Row;
  let studioC: Row;
  let accountB: Actor;
  let accountC: Actor;

  const contracts = () => admin.get<Contract[]>(`/projects/${project.id}/contracts`);
  const handoffs = () => admin.get<Handoff[]>(`/projects/${project.id}/handoffs`);
  const change = (studioId: string, offeredFeeVnd: number) =>
    admin.post<Handoff[]>(`/projects/${project.id}/studio-change`, {
      studioId,
      reason: 'Studio cũ không kịp tiến độ.',
      offeredFeeVnd,
    });

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 2);
    [studioB, studioC] = await Promise.all([newStudio(admin, 'Studio B'), newStudio(admin, 'Studio C')]);
    [accountB, accountC] = await Promise.all([studioAccount(admin, studioB.id), studioAccount(admin, studioC.id)]);
  });

  afterAll(() => app.close());

  it('sends the new studio a template and keeps its hand-off waiting for the signature', async () => {
    const history = await change(studioB.id, FEE_B);

    const [pending, old] = history;
    expect(pending).toMatchObject({ milestoneStatus: 'BRIEF_SENT', offeredFeeVnd: FEE_B, studio: { id: studioB.id } });
    expect(pending.contracts).toEqual([expect.objectContaining({ round: 1, status: 'SENT', costVnd: null })]);
    expect(old.milestoneStatus).toBe('SUPERSEDED');
    expect(old.contracts.map((c) => c.status)).toEqual(['SIGNED']);

    const rounds = await contracts();
    expect(rounds.map((c) => [c.studioId, c.status])).toEqual([
      [project.studio!.id, 'SIGNED'],
      [studioB.id, 'SENT'],
    ]);
    expect(rounds[1].handoffId).toBe(pending.id);

    // The brief goes out with the invitation to sign; the studio accounts are told in the app.
    const prisma = app.get(PrismaService);
    const { email } = await prisma.studio.findUniqueOrThrow({ where: { id: studioB.id } });
    const [mail] = await prisma.emailMessage.findMany({ where: { toEmail: email } });
    expect(mail).toMatchObject({ template: 'STUDIO_BRIEF' });
    expect(mail.attachmentKeys).toHaveLength(1);
    const bell = await accountB.get<{ data: { type: string; link: string }[] }>('/notifications');
    expect(bell.data).toContainEqual(expect.objectContaining({ type: 'CONTRACT_UPDATED', link: '/contracts' }));
  });

  it('lets the new studio read the project but not deliver before it signs', async () => {
    await accountB.get(`/studio-portal/projects/${project.id}`);
    const [first] = project.seasons[0].episodes;
    await accountB.upload(`/studio-portal/episodes/${first.id}/media/upload`, FILM, FILM_FIELDS, 409);
    // The replaced studio is out of the project.
    await studioOf(project.id).get(`/studio-portal/projects/${project.id}`, 404);
  });

  it('supersedes the open round when the Admin changes the studio again before it was signed', async () => {
    await change(studioC.id, FEE_C);

    const rounds = await contracts();
    expect(rounds.map((c) => [c.studioId, c.status])).toEqual([
      [project.studio!.id, 'SIGNED'],
      [studioB.id, 'SUPERSEDED'],
      [studioC.id, 'SENT'],
    ]);
    const [forB] = await accountB.get<Contract[]>('/studio-portal/contracts');
    expect(forB.status).toBe('SUPERSEDED');
    await proposeCost(accountB, forB.id, FEE_B, 409);
  });

  it('opens the hand-off once the new studio and the Admin both signed', async () => {
    const [template] = await accountC.get<Contract[]>('/studio-portal/contracts');
    expect(template).toMatchObject({ status: 'SENT', costVnd: null });

    await proposeCost(accountC, template.id, FEE_C);
    let [live] = await handoffs();
    expect(live).toMatchObject({ milestoneStatus: 'BRIEF_SENT', studio: { id: studioC.id } });
    await adminSign(admin, template.id);

    [live] = await handoffs();
    expect(live).toMatchObject({ milestoneStatus: 'IN_PROGRESS', offeredFeeVnd: FEE_C, studio: { id: studioC.id } });
    expect(live.contracts.map((c) => c.status)).toEqual(['SIGNED']);
    const detail = await admin.get<ProjectDetail>(`/projects/${project.id}`);
    expect(detail).toMatchObject({ status: 'IN_PRODUCTION', studio: { id: studioC.id } });

    // Production starts: the new studio may now deliver.
    const [first] = project.seasons[0].episodes;
    await accountC.upload(`/studio-portal/episodes/${first.id}/media/upload`, FILM, FILM_FIELDS);
  });
});
