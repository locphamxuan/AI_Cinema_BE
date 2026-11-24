import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { adminCounter, adminSign, proposeCost, SIGNATURE_PNG, studioSign } from './support/contracts';
import { DISCLOSURE, MP4 } from './support/media';
import {
  assignedProject,
  episodesOf,
  finalScript,
  HANDOFF_FEE_VND,
  newStudio,
  type ProjectDetail,
  studioAccount,
} from './support/projects';

interface Contract extends Row {
  round: number;
  status: string;
  costVnd: number | null;
  previousId: string | null;
  documents: { side: string; fileName: string; sizeBytes: number; checksum: string }[];
}

/**
 * MF-1 (22/11/2026): a contract is signed by uploading a signature image, not by clicking. The system draws each
 * signature into the same contract template the unsigned copy comes from, and renders the FINAL copy once both
 * are in; only then is the contract complete. This suite walks a whole negotiation through the two portals and
 * checks who may read what.
 */
describe('Contract signing by signature image (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let studio: Actor;
  let project: ProjectDetail;
  let contractId: string;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer02@aicinema.com'),
      signIn(app, 'creator02@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await assignedProject(reviewer, creator, 1);
    studio = await studioAccount(admin, project.studio!.id);
    await finalScript(reviewer, creator, project.id);
    [{ id: contractId }] = await admin.get<Contract[]>(`/projects/${project.id}/contracts`);
  });

  afterAll(() => app.close());

  const rounds = () => admin.get<Contract[]>(`/projects/${project.id}/contracts`);

  it('refuses anything that is not a signature image, and stores nothing for it', async () => {
    await studio.upload(
      `/studio-portal/contracts/${contractId}/propose`,
      { field: 'file', name: 'hop-dong.pdf', content: Buffer.from('%PDF-1.7 ban ky') },
      { costVnd: String(HANDOFF_FEE_VND) },
      400,
    );
    // A real PNG under a name that claims another type is refused the same way.
    await studio.upload(
      `/studio-portal/contracts/${contractId}/propose`,
      { field: 'file', name: 'chu-ky.jpg', content: SIGNATURE_PNG },
      { costVnd: String(HANDOFF_FEE_VND) },
      400,
    );
    const [template] = await rounds();
    expect(template).toMatchObject({ status: 'SENT', costVnd: null, documents: [] });
  });

  it('keeps the round open until both signatures are in', async () => {
    const proposed = (await proposeCost(studio, contractId, HANDOFF_FEE_VND)) as Contract;

    expect(proposed.status).toBe('STUDIO_SIGNED');
    expect(proposed.documents.map((document) => document.side)).toEqual(['STUDIO']);
    expect(proposed.documents[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    // Still no film: production waits for both signatures, one signature is not enough.
    await studio.upload(
      `/studio-portal/episodes/${episodesOf(project)[0].id}/media/upload`,
      { field: 'file', name: 'tap.mp4', content: MP4 },
      { aiDisclosure: JSON.stringify(DISCLOSURE), proposedLabelType: 'AI_GENERATED' },
      409,
    );
  });

  it('opens the next round with the Admin signature when the Admin counters', async () => {
    const countered = (await adminCounter(admin, contractId, HANDOFF_FEE_VND - 5_000_000)) as Contract;

    expect(countered).toMatchObject({ round: 2, status: 'ADMIN_COUNTERED' });
    expect(countered.documents.map((document) => document.side)).toEqual(['ADMIN']);
    contractId = countered.id;
    const all = await rounds();
    expect(all.map((round) => round.status)).toEqual(['SUPERSEDED', 'ADMIN_COUNTERED']);
  });

  it('renders the FINAL copy on the very pages of the unsigned contract when the studio signs', async () => {
    const unsigned = await studio.download(`/studio-portal/contracts/${contractId}/template`);
    const signed = (await studioSign(studio, contractId)) as Contract;

    expect(signed.status).toBe('SIGNED');
    expect(signed.documents.map((document) => document.side).sort()).toEqual(['ADMIN', 'FINAL', 'STUDIO']);
    const final = await admin.download(`/contracts/${contractId}/documents/FINAL/content`);
    expect(final.type).toContain('application/pdf');
    const pages = async (pdf: Buffer) => (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
    expect(await pages(final.body)).toBe(await pages(unsigned.body));
    expect((await reviewer.get<ProjectDetail>(`/projects/${project.id}`)).status).toBe('IN_PRODUCTION');
  });

  it('lets the Admin, the Reviewer and the studio of the contract download it, and nobody else', async () => {
    await expect(reviewer.download(`/contracts/${contractId}/documents/ADMIN/content`)).resolves.toBeDefined();
    await expect(
      studio.download(`/studio-portal/contracts/${contractId}/documents/FINAL/content`),
    ).resolves.toBeDefined();
    // The Creator of the project holds no contract:document.read.
    await creator.get(`/contracts/${contractId}/documents/FINAL/content`, 403);

    const stranger = await studioAccount(admin, (await newStudio(admin, 'Studio lạ')).id);
    await stranger.get(`/studio-portal/contracts/${contractId}/documents/FINAL/content`, 404);
    await stranger.get(`/contracts/${contractId}/documents/FINAL/content`, 403);
  });

  it('names every copy after the contract number and keeps the project and round ids in the PDF', async () => {
    const [signed] = (await rounds()).filter((round) => round.status === 'SIGNED');
    const names = signed.documents.map((document) => document.fileName).sort();
    const no = `AIC-${new Date().getUTCFullYear()}-${contractId.slice(0, 8).toUpperCase()}-R2`;
    expect(names).toEqual([
      `hop-dong-ai-cinema-da-ky-${no}.pdf`,
      `hop-dong-du-chu-ky-${no}.pdf`,
      `hop-dong-studio-da-ky-${no}.pdf`,
    ]);
    const final = await studio.download(`/studio-portal/contracts/${contractId}/documents/FINAL/content`);
    const keywords = (await PDFDocument.load(final.body, { updateMetadata: false })).getKeywords();
    expect(keywords).toContain(`aicinema-project:${project.id}`);
    expect(keywords).toContain(`aicinema-contract:${contractId}`);
  });

  it('refuses a second signature on a contract that is already complete', async () => {
    await adminSign(admin, contractId, 409);
    await proposeCost(studio, contractId, HANDOFF_FEE_VND, 409);
  });
});

/**
 * Rounds one side signed before signature images (22/11/2026) hold no image of that signature, so the other side
 * cannot complete them. Signing is refused with a clear reason before anything is stored, and the migration
 * 20261124100000 re-opens such a round as a fresh unsigned one the studio signs again with an image.
 */
describe('Contract rounds signed before signature images (e2e)', () => {
  const MIGRATION = join(__dirname, '../prisma/migrations/20261124100000_reopen_legacy_contract_rounds/migration.sql');
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: Actor;
  let studio: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    const [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer02@aicinema.com'),
      signIn(app, 'creator02@aicinema.com'),
    ]);
    admin = await signIn(app, 'admin@aicinema.com');
    project = await assignedProject(reviewer, creator, 1);
    studio = await studioAccount(admin, project.studio!.id);
    await finalScript(reviewer, creator, project.id);
  });

  afterAll(() => app.close());

  const rounds = () => admin.get<Contract[]>(`/projects/${project.id}/contracts`);

  it('refuses to countersign a round whose studio signature has no image, storing nothing', async () => {
    const [template] = await rounds();
    await proposeCost(studio, template.id, HANDOFF_FEE_VND);
    // What a round signed by uploading a PDF looked like: signed, but no signature image on record.
    await prisma.contractSignature.deleteMany({ where: { contractId: template.id } });

    const refused = await adminSign(admin, template.id, 409);

    expect(JSON.stringify(refused)).toContain('COUNTERPART_SIGNATURE_MISSING');
    const [still] = await rounds();
    expect(still.status).toBe('STUDIO_SIGNED');
    expect(await prisma.contractSignature.count({ where: { contractId: template.id } })).toBe(0);
  });

  it('re-opens the round unsigned for the same studio once the migration runs, and only once', async () => {
    const sql = readFileSync(MIGRATION, 'utf8').trim().replace(/;$/, '');
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);

    const [legacy, reopened, ...more] = await rounds();
    expect(more).toEqual([]);
    expect(legacy.status).toBe('SUPERSEDED');
    expect(reopened).toMatchObject({ status: 'SENT', round: 2, costVnd: null, previousId: legacy.id, documents: [] });
    const told = await prisma.notification.count({
      where: { userId: studio.id, type: 'CONTRACT_UPDATED', payload: { path: ['contractId'], equals: reopened.id } },
    });
    expect(told).toBe(1);
  });

  it('completes the re-opened round with both signature images', async () => {
    const reopened = (await rounds()).find((round) => round.status === 'SENT')!;
    await proposeCost(studio, reopened.id, HANDOFF_FEE_VND);
    const signed = (await adminSign(admin, reopened.id)) as Contract;

    expect(signed.status).toBe('SIGNED');
    expect(signed.documents.map((document) => document.side).sort()).toEqual(['ADMIN', 'FINAL', 'STUDIO']);
  });
});
