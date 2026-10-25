import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, signIn } from './support/api';
import { assignedProject, episodesOf, type ProjectDetail } from './support/projects';

// The 8-byte PNG signature is enough: only the first bytes are checked.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('Project artwork (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
    project = await assignedProject(reviewer, creator, 1);
  });

  afterAll(() => app.close());

  it('stores the poster of a project and the thumbnail of an episode, for the Reviewer only', async () => {
    const poster = { field: 'file', name: 'poster.png', content: PNG };
    await creator.upload(`/projects/${project.id}/poster`, poster, {}, 403);

    const stored = await reviewer.upload<{ posterUrl: string }>(`/projects/${project.id}/poster`, poster);
    expect(stored.posterUrl).toMatch(/\.png$/);
    expect((await reviewer.get<{ posterUrl: string }>(`/projects/${project.id}`)).posterUrl).toBe(stored.posterUrl);

    const [episode] = episodesOf(project);
    const thumb = await reviewer.upload<{ thumbnailUrl: string }>(`/episodes/${episode.id}/thumbnail`, {
      ...poster,
      name: 'tap-1.png',
    });
    expect(thumb.thumbnailUrl).toMatch(/\.png$/);
  });

  it('checks the content of the image, not its name', async () => {
    const fake = { field: 'file', name: 'poster.png', content: Buffer.from('not an image') };
    await reviewer.upload(`/projects/${project.id}/poster`, fake, {}, 400);
    await reviewer.upload(`/projects/${project.id}/poster`, [], {}, 400);
  });
});
