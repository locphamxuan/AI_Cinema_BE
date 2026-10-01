import { loadConfig } from './app-config';

const base = { DATABASE_URL: 'postgresql://localhost/db', JWT_SECRET: 'dev-secret' };

describe('loadConfig', () => {
  it('fills in development defaults', () => {
    const config = loadConfig(base);
    expect(config.isProduction).toBe(false);
    expect(config.swaggerEnabled).toBe(true);
    expect(config.storage).toMatchObject({ driver: 'local', publicBaseUrl: 'http://localhost:3001/media' });
    expect(config.jwt.accessTtlSeconds).toBe(900);
    expect(config.redisUrl).toBeNull();
  });

  it('lists every invalid or missing setting at once', () => {
    const failure = () => loadConfig({ PORT: 'abc', STORAGE_DRIVER: 'ftp' });
    for (const problem of [
      'DATABASE_URL is required',
      'JWT_SECRET is required',
      'PORT must be',
      'STORAGE_DRIVER must be',
    ]) {
      expect(failure).toThrow(problem);
    }
  });

  it('refuses a weak JWT secret and private media URLs in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MEDIA_ALLOW_PRIVATE_URLS: 'true' })).toThrow(
      /JWT_SECRET must be a random string[\s\S]*MEDIA_ALLOW_PRIVATE_URLS/,
    );
  });

  it('hides Swagger in production unless it is switched on', () => {
    const production = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) };
    expect(loadConfig(production).swaggerEnabled).toBe(false);
    expect(loadConfig({ ...production, SWAGGER_ENABLED: 'true' }).swaggerEnabled).toBe(true);
  });

  it('requires the bucket credentials only with the S3 driver', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET is required/);
    const config = loadConfig({
      ...base,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'media',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/',
    });
    expect(config.storage.publicBaseUrl).toBe('https://cdn.example.com');
  });
});
