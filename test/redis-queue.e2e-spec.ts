import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { loadConfig } from 'src/config/app-config';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { type Actor, bootApp, signIn } from './support/api';
import { E2E_REDIS_URL } from './e2e-env';
import { deliver } from './support/media';
import { episodesOf, projectInProduction } from './support/projects';

const queueOn = (redisUrl: string) =>
  new JobQueue(loadConfig({ DATABASE_URL: 'postgresql://x/y', JWT_SECRET: 's', REDIS_URL: redisUrl }));

/** Resolves once `check` is true, polling every 100 ms. */
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting for the queue');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Job queue on Redis (e2e)', () => {
  const queue = queueOn(E2E_REDIS_URL);
  // Fresh queue names per run, so jobs left in Redis by an earlier run never interfere.
  const name = (suffix: string) => `e2e-${suffix}-${randomUUID()}`;

  beforeAll(() => jest.spyOn(queue['logger'], 'error').mockImplementation(() => undefined));
  afterAll(() => queue.onApplicationShutdown());

  it('runs a queued job on a BullMQ worker', async () => {
    const seen: unknown[] = [];
    const job = name('run');
    queue.register(job, (data) => {
      seen.push(data);
      return Promise.resolve();
    });

    await queue.add(job, { id: 1 });

    expect(queue.runsInBackground).toBe(true);
    await until(() => seen.length === 1);
    expect(seen).toEqual([{ id: 1 }]);
  });

  it('retries a failing job and reports it once every attempt failed', async () => {
    const job = name('flaky');
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const onFailed = jest.fn().mockResolvedValue(undefined);
    queue.register(job, handler, { attempts: 2, backoffMs: 50, onFailed });

    await queue.add(job, { id: 2 });

    await until(() => onFailed.mock.calls.length === 1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(onFailed).toHaveBeenCalledWith({ id: 2 }, expect.objectContaining({ message: 'boom' }));
  });

  it('runs a job added twice with the same id only once', async () => {
    const job = name('dedupe');
    const handler = jest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
    queue.register(job, handler);

    await queue.add(job, {}, 'same-id');
    await queue.add(job, {}, 'same-id');

    await until(() => handler.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs a schedule repeatedly', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.every(name('every'), 200, handler);

    await until(() => handler.mock.calls.length >= 2);
  });

  it('reports Redis as up', async () => {
    await expect(queue.redisStatus()).resolves.toBe('up');
  });

  describe('with Redis unreachable', () => {
    const down = queueOn('redis://127.0.0.1:1');

    beforeAll(() => {
      jest.spyOn(down['logger'], 'error').mockImplementation(() => undefined);
      jest.spyOn(down['logger'], 'warn').mockImplementation(() => undefined);
    });

    it('fails adding a job instead of hanging, and reports Redis as down', async () => {
      const job = name('down');
      down.register(job, jest.fn());

      await expect(down.add(job, {})).rejects.toThrow('did not accept');
      await expect(down.redisStatus()).resolves.toBe('down');
    }, 15_000);

    it('still shuts down', async () => {
      await down.onApplicationShutdown();
    }, 15_000);
  });
});

describe('Media delivery through Redis (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;

  beforeAll(async () => {
    process.env.REDIS_URL = E2E_REDIS_URL;
    app = await bootApp();
    [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
  });

  afterAll(async () => {
    await app.close();
    process.env.REDIS_URL = '';
  });

  it('reports Redis in the health check', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });

  it('queues the delivery and the worker sends the episode to review', async () => {
    const project = await projectInProduction(reviewer, creator, 1);
    const [episode] = episodesOf(project);

    const queued = await deliver(creator, episode.id);
    expect(['PENDING', 'READY']).toContain(queued.ingestStatus);

    await until(async () => (await creator.get(`/media-assets/${queued.id}`)).ingestStatus === 'READY');
    const detail = await reviewer.get<{ seasons: { episodes: { status: string }[] }[] }>(`/projects/${project.id}`);
    expect(detail.seasons[0].episodes[0].status).toBe('IN_REVIEW');
  });
});
