import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { ContractController } from 'src/modules/production/contract/contract.controller';
import { StudioPortalController } from './studio-portal.controller';

const user = { id: 'u-studio', role: 'STUDIO' } as unknown as AuthenticatedUser;
const file = { originalname: 'signed.pdf' } as Express.Multer.File;

function portalController() {
  const portal = {
    me: jest.fn(),
    studioOf: jest.fn().mockResolvedValue('st1'),
    projects: jest.fn(),
    project: jest.fn(),
  };
  const contracts = { forStudio: jest.fn(), propose: jest.fn(), studioSign: jest.fn(), studioCounter: jest.fn() };
  const documents = { downloadForStudio: jest.fn() };
  const templates = { forStudio: jest.fn() };
  const media = { submitLink: jest.fn(), submitUpload: jest.fn(), retry: jest.fn() };
  const uploads = {
    start: jest.fn().mockResolvedValue({ uploadId: 'up1' }),
    complete: jest.fn().mockResolvedValue({ id: 'ma1' }),
  };
  const controller = new StudioPortalController(
    portal as never,
    contracts as never,
    documents as never,
    templates as never,
    media as never,
    uploads as never,
  );
  return { controller, portal, contracts, documents, templates, media, uploads };
}

describe('StudioPortalController', () => {
  it('answers the studio of the signed-in account with its contracts, template and signed documents', async () => {
    const { controller, contracts, templates, documents } = portalController();
    await controller.listContracts(user);
    expect(contracts.forStudio).toHaveBeenCalledWith('st1');
    await controller.downloadTemplate('k1', user);
    expect(templates.forStudio).toHaveBeenCalledWith('k1', 'st1');
    await controller.downloadContract('k1', 'FINAL', user);
    expect(documents.downloadForStudio).toHaveBeenCalledWith('k1', 'FINAL', 'st1');
  });

  it('records every signature against both the studio and the account that uploaded it', async () => {
    const { controller, contracts } = portalController();
    const actor = { studioId: 'st1', userId: 'u-studio' };
    await controller.propose('k1', file, { costVnd: 150_000_000 }, user);
    expect(contracts.propose).toHaveBeenCalledWith('k1', 150_000_000, actor, file);
    await controller.sign('k1', file, user);
    expect(contracts.studioSign).toHaveBeenCalledWith('k1', actor, file);
    await controller.counter('k1', file, { costVnd: 160_000_000 }, user);
    expect(contracts.studioCounter).toHaveBeenCalledWith('k1', 160_000_000, actor, file);
  });

  it('starts and completes a direct upload of a film for the episode', async () => {
    const { controller, uploads } = portalController();
    await expect(controller.startUpload('e1', { fileName: 'tap1.mp4', sizeBytes: 1024 }, user)).resolves.toEqual({
      uploadId: 'up1',
    });
    expect(uploads.start).toHaveBeenCalledWith('e1', { fileName: 'tap1.mp4', sizeBytes: 1024 }, user);
    const done = { uploadToken: 't', proposedLabelType: 'AI_GENERATED', aiDisclosure: {} } as never;
    await expect(controller.completeUpload('e1', done, user)).resolves.toEqual({ id: 'ma1' });
    expect(uploads.complete).toHaveBeenCalledWith('e1', done, user);
  });

  it('passes profile, projects, links and retries through to their services', async () => {
    const { controller, portal, media } = portalController();
    await controller.me(user);
    await controller.projects(user);
    await controller.project('p1', user);
    await controller.submitLink('e1', { sourceUrl: 'https://cdn.example/a.m3u8' } as never, user);
    await controller.retry('ma1', user);
    expect(portal.me).toHaveBeenCalledWith(user);
    expect(portal.projects).toHaveBeenCalledWith(user);
    expect(portal.project).toHaveBeenCalledWith('p1', user);
    expect(media.submitLink).toHaveBeenCalledWith('e1', { sourceUrl: 'https://cdn.example/a.m3u8' }, user);
    expect(media.retry).toHaveBeenCalledWith('ma1', user);
  });
});

describe('ContractController', () => {
  it('lets the Admin and the Reviewer download the unsigned template of a round', async () => {
    const templates = { forStaff: jest.fn().mockResolvedValue('pdf') };
    const controller = new ContractController({} as never, {} as never, templates as never);
    await expect(controller.template('k1', user)).resolves.toBe('pdf');
    expect(templates.forStaff).toHaveBeenCalledWith('k1', user);
  });
});
