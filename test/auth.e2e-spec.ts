import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AuthSessionDto } from 'src/modules/identity/auth/dto/auth-session.dto';
import { bootApp } from './support/api';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  const email = `member-${randomUUID()}@example.com`;
  const password = 'Secret123';
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up a member without asking for a birthday (BR-54)', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email, password, fullName: 'Nguyễn Minh Anh' })
      .expect(201);
    const session = res.body as AuthSessionDto;
    expect(session.user).toMatchObject({ email, role: 'MEMBER' });
    expect(session.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a weak password', async () => {
    await api()
      .post('/api/auth/register')
      .send({
        email: `weak-${randomUUID()}@example.com`,
        password: 'password',
        fullName: 'Weak',
      })
      .expect(400);
  });

  it('rotates refresh tokens and signs everything out when an old one is replayed', async () => {
    const login = (await api().post('/api/auth/login').send({ email, password }).expect(200)).body as AuthSessionDto;
    await api().get('/api/auth/me').set('Authorization', `Bearer ${login.accessToken}`).expect(200);

    const rotated = (await api().post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(200))
      .body as AuthSessionDto;
    expect(rotated.refreshToken).not.toBe(login.refreshToken);

    // The first token was already used: replaying it revokes the rotated one too.
    await api().post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
    await api().post('/api/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const login = (await api().post('/api/auth/login').send({ email, password }).expect(200)).body as AuthSessionDto;
    await api().post('/api/auth/logout').send({ refreshToken: login.refreshToken }).expect(204);
    await api().post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
  });

  it('does not accept a token signed with another secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IkFETUlOIiwidHlwZSI6ImFjY2VzcyJ9.c2lnbmF0dXJl';
    await api().get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});
