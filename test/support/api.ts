import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import type { Row } from './types';

/** Password of every seeded staff account (prisma/seed.ts). */
export const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Aicinema@123';

export async function bootApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** A signed-in actor: every call goes to /api with its bearer token and expects `status`. */
export class Actor {
  constructor(
    private readonly app: INestApplication<App>,
    private readonly token: string,
    readonly id: string,
  ) {}

  async call<T = Row>(method: Method, path: string, body?: object, status = method === 'post' ? 201 : 200): Promise<T> {
    const res = await request(this.app.getHttpServer())
      [method](`/api${path}`)
      .set('Authorization', `Bearer ${this.token}`)
      .send(body);
    if (res.status !== status) {
      throw new Error(
        `${method.toUpperCase()} ${path} -> ${res.status} (expected ${status}): ${JSON.stringify(res.body)}`,
      );
    }
    return res.body as T;
  }

  get<T = Row>(path: string, status?: number) {
    return this.call<T>('get', path, undefined, status);
  }

  post<T = Row>(path: string, body: object = {}, status?: number) {
    return this.call<T>('post', path, body, status);
  }

  patch<T = Row>(path: string, body: object, status?: number) {
    return this.call<T>('patch', path, body, status);
  }
}

export async function signIn(app: INestApplication<App>, email: string, password = SEED_PASSWORD): Promise<Actor> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login of ${email} failed with ${res.status}`);
  const body = res.body as { accessToken: string; user: { id: string } };
  return new Actor(app, body.accessToken, body.user.id);
}
