import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';

describe('Account management (e2e)', () => {
  let app: INestApplication<App>;
  let admin: Actor;
  let reviewer: Actor;
  const email = `staff-${Date.now()}@aicinema.test`;
  const login = (address: string, password: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email: address, password });

  beforeAll(async () => {
    app = await bootApp();
    [admin, reviewer] = await Promise.all([signIn(app, 'admin@aicinema.com'), signIn(app, 'reviewer01@aicinema.com')]);
  });

  afterAll(() => app.close());

  it('creates, edits and deletes an account that has no activity', async () => {
    const created = await admin.post<Row & { email: string }>('/users', {
      email,
      fullName: 'Nhân viên Thử',
      role: 'STAFF',
      password: 'Aicinema@123',
    });
    await admin.post('/users', { email, fullName: 'Trùng', role: 'STAFF', password: 'Aicinema@123' }, 409);

    const renamed = `renamed-${email}`;
    const edited = await admin.patch<Row & { email: string; fullName: string }>(`/users/${created.id}`, {
      fullName: 'Nhân viên Đã Sửa',
      email: renamed,
      password: 'Moi@12345',
    });
    expect(edited).toMatchObject({ fullName: 'Nhân viên Đã Sửa', email: renamed });
    expect(edited).not.toHaveProperty('passwordHash');
    await login(renamed, 'Aicinema@123').expect(401);
    await login(renamed, 'Moi@12345').expect(200);
    await admin.patch(`/users/${created.id}`, { email: 'admin@aicinema.com' }, 409);

    await reviewer.call('delete', `/users/${created.id}`, undefined, 403);
    await admin.call('delete', `/users/${created.id}`, undefined, 204);
    await admin.call('delete', `/users/${created.id}`, undefined, 404);
    await login(renamed, 'Moi@12345').expect(401);
  });

  it('keeps accounts with history and the Admin’s own account', async () => {
    // reviewer01 owns projects and Token entries: lock it rather than delete it.
    await admin.call('delete', `/users/${reviewer.id}`, undefined, 409);
    await admin.call('delete', `/users/${admin.id}`, undefined, 400);
  });
});
