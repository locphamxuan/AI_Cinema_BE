import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Points the e2e suite at its own throwaway database (docker-compose.test.yml),
 * set before .env is read so the shared development database is never touched.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/ai_cinema_e2e';

/** Redis of the queue suite (redis-queue.e2e-spec.ts); every other suite runs jobs inline. */
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:63799';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function assertLocalDatabase(url: string) {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run e2e tests against a non-local server (${host})`);
  }
}

assertLocalDatabase(E2E_DATABASE_URL);
assertLocalDatabase(E2E_REDIS_URL);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = E2E_DATABASE_URL;
process.env.JWT_SECRET ??= 'e2e-secret';
// Jobs run inside the request and media is not really transcoded, so each step is done when it returns.
process.env.REDIS_URL = '';
process.env.MEDIA_PIPELINE = 'mock';
// The studio CDN of the media suite runs on 127.0.0.1.
process.env.MEDIA_ALLOW_PRIVATE_URLS = 'true';
process.env.SMTP_HOST = '';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_ROOT = join(tmpdir(), 'ai-cinema-e2e-storage');
process.env.SWAGGER_ENABLED = 'false';
// The suite signs in many times a minute.
process.env.RATE_LIMIT_MAX = '10000';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
// Schedulers are driven by the tests, never by timers.
process.env.PUBLICATION_SWEEP_MS = '0';
process.env.OVERDUE_SWEEP_MS = '0';
process.env.HLS_CHECK_MS = '0';
