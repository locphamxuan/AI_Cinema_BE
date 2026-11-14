import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { hashPassword } from 'src/modules/identity/auth/credentials';
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

  it('signs up an adult member and refuses a minor (BR-54)', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email, password, fullName: 'Nguyễn Minh Anh', dateOfBirth: '2001-02-03' })
      .expect(201);
    const session = res.body as AuthSessionDto;
    expect(session.user).toMatchObject({ email, role: 'MEMBER' });
    expect(session.user).not.toHaveProperty('passwordHash');

    await api()
      .post('/api/auth/register')
      .send({ email: `minor-${randomUUID()}@example.com`, password, fullName: 'Em', dateOfBirth: '2015-01-01' })
      .expect(403);
  });

  it('rejects a weak password', async () => {
    await api()
      .post('/api/auth/register')
      .send({
        email: `weak-${randomUUID()}@example.com`,
        password: 'password',
        fullName: 'Weak',
        dateOfBirth: '2000-01-01',
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

  it('resets a forgotten password with the e-mailed OTP and signs the old sessions out', async () => {
    const prisma = app.get(PrismaService);
    const old = (await api().post('/api/auth/login').send({ email, password }).expect(200)).body as AuthSessionDto;

    // An unknown email gets the same answer, and no mail.
    await api()
      .post('/api/auth/forgot-password')
      .send({ email: `nobody-${randomUUID()}@example.com` })
      .expect(200);
    await api().post('/api/auth/forgot-password').send({ email: email.toUpperCase() }).expect(200);
    const mail = await prisma.emailMessage.findFirstOrThrow({
      where: { toEmail: email, template: 'PASSWORD_RESET_OTP' },
      orderBy: { createdAt: 'desc' },
    });
    const otp = /(\d{6})/.exec((mail.payload as { text: string }).text)?.[1] ?? '';
    const wrong = otp === '000000' ? '111111' : '000000';
    const newPassword = 'Changed123';

    await api().post('/api/auth/reset-password').send({ email, otp: wrong, newPassword }).expect(401);
    const reset = (await api().post('/api/auth/reset-password').send({ email, otp, newPassword }).expect(200))
      .body as AuthSessionDto;
    expect(reset.user).toMatchObject({ email });

    // The code works once, the old session is gone, and only the new password signs in.
    await api().post('/api/auth/reset-password').send({ email, otp, newPassword: 'Another123' }).expect(401);
    await api().post('/api/auth/refresh').send({ refreshToken: old.refreshToken }).expect(401);
    await api().post('/api/auth/login').send({ email, password }).expect(401);
    await api().post('/api/auth/login').send({ email, password: newPassword }).expect(200);
    await prisma.user.update({ where: { email }, data: { passwordHash: await hashPassword(password) } });
  });

  it('mails no reset code to a staff account: forgot password is for Members only', async () => {
    const prisma = app.get(PrismaService);
    const staff = 'reviewer01@aicinema.com';
    const before = await prisma.emailMessage.count({ where: { toEmail: staff, template: 'PASSWORD_RESET_OTP' } });
    await api().post('/api/auth/forgot-password').send({ email: staff }).expect(200);
    expect(await prisma.emailMessage.count({ where: { toEmail: staff, template: 'PASSWORD_RESET_OTP' } })).toBe(before);
    await api()
      .post('/api/auth/reset-password')
      .send({ email: staff, otp: '123456', newPassword: 'Changed123' })
      .expect(401);
  });

  it('does not accept a token signed with another secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IkFETUlOIiwidHlwZSI6ImFjY2VzcyJ9.c2lnbmF0dXJl';
    await api().get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});
