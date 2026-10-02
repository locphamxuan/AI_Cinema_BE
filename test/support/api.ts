import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';

/** The fields of an API response the suite reads. */
export type Row = Record<string, unknown> & { id: string };

/** Password of every seeded account (prisma/seed.ts). */
export const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Aicinema@123';

export async function bootApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

const DEFAULT_STATUS: Record<Method, number> = { get: 200, post: 201, patch: 200, put: 200, delete: 200 };

/** A signed-in actor: every call goes to /api with its bearer token and expects `status`. */
export class Actor {
  constructor(
    private readonly app: INestApplication<App>,
    private readonly token: string,
    readonly id: string,
  ) {}

  async call<T = Row>(method: Method, path: string, body?: object, status = DEFAULT_STATUS[method]): Promise<T> {
    const res = await request(this.app.getHttpServer())
      [method](`/api${path}`)
      .set('Authorization', `Bearer ${this.token}`)
      .send(body);
    return this.expect<T>(res, `${method.toUpperCase()} ${path}`, status);
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

  put<T = Row>(path: string, body: object, status?: number) {
    return this.call<T>('put', path, body, status);
  }

  /** multipart/form-data upload of one file plus text fields. */
  async upload<T = Row>(
    path: string,
    file: { field: string; name: string; content: Buffer },
    fields: Record<string, string> = {},
    status = 201,
  ): Promise<T> {
    let req = request(this.app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${this.token}`)
      .attach(file.field, file.content, file.name);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return this.expect<T>(await req, `UPLOAD ${path}`, status);
  }

  /** Raw download, for endpoints that stream a file. */
  async download(path: string): Promise<{ body: Buffer; type: string }> {
    const res = await request(this.app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${this.token}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    if (res.status !== 200) throw new Error(`GET ${path} -> ${res.status}`);
    return { body: res.body as Buffer, type: String(res.headers['content-type']) };
  }

  private expect<T>(res: request.Response, what: string, status: number): T {
    if (res.status !== status) {
      throw new Error(`${what} -> ${res.status} (expected ${status}): ${JSON.stringify(res.body)}`);
    }
    return res.body as T;
  }
}

export async function signIn(app: INestApplication<App>, email: string, password = SEED_PASSWORD): Promise<Actor> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login of ${email} failed with ${res.status}`);
  const body = res.body as { accessToken: string; user: { id: string } };
  return new Actor(app, body.accessToken, body.user.id);
}
