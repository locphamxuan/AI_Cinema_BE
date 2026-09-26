/**
 * Points the e2e suite at its own throwaway database (docker-compose.test.yml),
 * set before .env is read so the shared development database is never touched.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/ai_cinema_e2e';

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

export function assertLocalDatabase(url: string) {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`Refusing to run e2e tests against a non-local database (${host})`);
  }
}

assertLocalDatabase(E2E_DATABASE_URL);
process.env.DATABASE_URL = E2E_DATABASE_URL;
// The suite never calls a real AI service, whatever the developer's .env says.
process.env.AI_PROVIDER_MODE = 'mock';
// Jobs run inline and the cut is not transcoded, so every step is finished when its request returns.
process.env.REDIS_URL = '';
process.env.VIDEO_TRANSCODER = 'mock';
process.env.JWT_SECRET ??= 'e2e-secret';
process.env.JWT_ACCESS_EXPIRES_IN ??= '1h';
process.env.JWT_REFRESH_EXPIRES_IN ??= '1d';
