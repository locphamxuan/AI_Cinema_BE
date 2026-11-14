import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { assignedProject } from './support/projects';

interface Studio extends Row {
  name: string;
  email: string;
  isActive: boolean;
}

describe('Studio catalog (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let admin: Actor;
  let creator: Actor;
  let member: Actor;
  const email = `catalog-${Date.now()}@anhtrang.example`;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, admin, creator, member] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'member01@aicinema.com'),
    ]);
  });

  afterAll(() => app.close());

  it('is kept by the Admin and the Reviewer; Creators no longer deal with studios (BR-59, MF-1 08/11)', async () => {
    await creator.post('/studios', { name: 'Studio X', email }, 403);
    await member.get('/studios', 403);
    await creator.get('/studios', 403);
    // Only the Admin manages the studio catalog (12/11/2026); the Reviewer still reads it.
    await reviewer.post('/studios', { name: 'Studio Reviewer', email }, 403);
    await admin.post('/studios', { name: 'S', email }, 400);
    await admin.post('/studios', { name: 'Studio X', email: 'not-an-email' }, 400);
  });

  it('adds a studio with a unique, lower-cased email and edits it', async () => {
    const studio = await admin.post<Studio>('/studios', {
      name: '  Studio Ánh Trăng ',
      email: email.toUpperCase(),
      contactName: 'Chị Lan',
      phone: '0901 234 567',
    });
    expect(studio).toMatchObject({ name: 'Studio Ánh Trăng', email, isActive: true });
    await admin.post('/studios', { name: 'Trùng email', email }, 409);

    const edited = await admin.patch<Studio>(`/studios/${studio.id}`, { note: 'Giao đúng hạn.' });
    expect(edited).toMatchObject({ name: 'Studio Ánh Trăng', note: 'Giao đúng hạn.' });
    await reviewer.get(`/studios/00000000-0000-4000-8000-000000000000`, 404);
  });

  it('lists active studios on request and deletes only a studio nobody used', async () => {
    const unused = await admin.post<Studio>('/studios', { name: 'Studio chưa dùng', email: `u-${email}` });
    await admin.patch(`/studios/${unused.id}`, { isActive: false });
    const active = await reviewer.get<Studio[]>('/studios?active=true');
    const inactive = await reviewer.get<Studio[]>('/studios?active=false');
    expect(active.some((s) => s.id === unused.id)).toBe(false);
    expect(inactive.some((s) => s.id === unused.id)).toBe(true);
    await admin.call('delete', `/studios/${unused.id}`, undefined, 204);
    await reviewer.get(`/studios/${unused.id}`, 404);

    const project = await assignedProject(reviewer, creator, 1);
    const usedBy = (await reviewer.get<{ studio: { id: string } }>(`/projects/${project.id}`)).studio.id;
    await admin.call('delete', `/studios/${usedBy}`, undefined, 409);
  });
});
