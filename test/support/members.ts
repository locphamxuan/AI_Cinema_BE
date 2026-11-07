import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { type Actor, signIn } from './api';

let registered = 0;

/** A brand-new adult member with an empty wallet, signed in. */
export async function registerMember(app: INestApplication<App>): Promise<Actor> {
  registered += 1;
  const email = `member-${Date.now()}-${registered}@aicinema.test`;
  const password = 'Member@123';
  await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, fullName: 'Thành viên e2e', dateOfBirth: '2000-01-01' })
    .expect(201);
  return signIn(app, email, password);
}
