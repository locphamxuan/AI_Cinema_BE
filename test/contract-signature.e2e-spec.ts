import { INestApplication } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { adminCounter, adminSign, proposeCost, signedPdf, studioSign } from './support/contracts';
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
  documents: { side: string; fileName: string; sizeBytes: number; checksum: string }[];
}

/**
 * MF-1 (10/11/2026): a contract is signed by uploading a PDF, not by clicking. Each side uploads the contract
 * carrying its own signature and the system merges both into one FINAL document; only then is the contract
 * complete. This suite walks a whole negotiation through the two portals and checks who may read what.
 */
describe('Signed contract PDFs (e2e)', () => {
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

  it('refuses anything that is not a readable PDF, and stores nothing for it', async () => {
    await studio.upload(
      `/studio-portal/contracts/${contractId}/propose`,
      { field: 'file', name: 'hop-dong.pdf', content: Buffer.from('Toi ky bang Word') },
      { costVnd: String(HANDOFF_FEE_VND) },
      400,
    );
    // A real PDF under a name that claims another type is refused the same way.
    await studio.upload(
      `/studio-portal/contracts/${contractId}/propose`,
      { field: 'file', name: 'hop-dong.docx', content: await signedPdf('Ban ky') },
      { costVnd: String(HANDOFF_FEE_VND) },
      400,
    );
    const [template] = await rounds();
    expect(template).toMatchObject({ status: 'SENT', costVnd: null, documents: [] });
  });

  it('keeps the round open until both counterparts are in', async () => {
    const proposed = (await proposeCost(studio, contractId, HANDOFF_FEE_VND)) as Contract;

    expect(proposed.status).toBe('STUDIO_SIGNED');
    expect(proposed.documents.map((document) => document.side)).toEqual(['STUDIO']);
    expect(proposed.documents[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    // Still no film: production waits for both signatures, one counterpart is not enough.
    await studio.upload(
      `/studio-portal/episodes/${episodesOf(project)[0].id}/media/upload`,
      { field: 'file', name: 'tap.mp4', content: MP4 },
      { aiDisclosure: JSON.stringify(DISCLOSURE), proposedLabelType: 'AI_GENERATED' },
      409,
    );
  });

  it('carries the Admin counterpart over to the next round when the Admin counters', async () => {
    const countered = (await adminCounter(admin, contractId, HANDOFF_FEE_VND - 5_000_000)) as Contract;

    expect(countered).toMatchObject({ round: 2, status: 'ADMIN_COUNTERED' });
    expect(countered.documents.map((document) => document.side)).toEqual(['ADMIN']);
    contractId = countered.id;
    const all = await rounds();
    expect(all.map((round) => round.status)).toEqual(['SUPERSEDED', 'ADMIN_COUNTERED']);
  });

  it('merges both counterparts into one final document when the studio signs', async () => {
    const signed = (await studioSign(studio, contractId)) as Contract;

    expect(signed.status).toBe('SIGNED');
    expect(signed.documents.map((document) => document.side).sort()).toEqual(['ADMIN', 'FINAL', 'STUDIO']);
    const final = await admin.download(`/contracts/${contractId}/documents/FINAL/content`);
    expect(final.type).toContain('application/pdf');
    const merged = await PDFDocument.load(final.body, { updateMetadata: false });
    // 1 Admin page + 1 studio page + the page the system draws with both signature blocks.
    expect(merged.getPageCount()).toBe(3);
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

  it('refuses a second signature on a contract that is already complete', async () => {
    await adminSign(admin, contractId, 409);
    await proposeCost(studio, contractId, HANDOFF_FEE_VND, 409);
  });
});
