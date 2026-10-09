import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from 'src/common/http/api-exception.filter';
import { bootApp } from './support/api';

describe('Platform (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy while the database answers', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'off' });
  });

  it('sends security headers and a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
  });

  it('answers errors in the API error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/users').expect(401);
    const body = res.body as ApiErrorBody;
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects fields a DTO does not declare', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a@b.co', password: 'secret12', role: 'ADMIN' })
      .expect(400);
    expect((res.body as ApiErrorBody).error.details).toEqual(expect.arrayContaining([expect.stringContaining('role')]));
  });
});
