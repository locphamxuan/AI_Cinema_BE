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

  it('leaves payment gateways unconfigured by default (sandbox URLs kept)', () => {
    const config = loadConfig(base);
    expect(config.payments.momo).toMatchObject({
      partnerCode: undefined,
      accessKey: undefined,
      secretKey: undefined,
      createUrl: 'https://test-payment.momo.vn/v2/gateway/api/create',
      statusUrl: 'https://test-payment.momo.vn/v2/gateway/api/transaction-status',
      requestType: 'payWithMethod',
    });
    expect(config.payments.vnpay).toMatchObject({
      tmnCode: undefined,
      hashSecret: undefined,
      payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      returnUrl: undefined,
      ipnUrl: undefined,
      apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
    });
  });

  it('reads payment gateway credentials from the environment', () => {
    const config = loadConfig({
      ...base,
      MOMO_PARTNER_CODE: 'MOMO',
      MOMO_ACCESS_KEY: 'key',
      MOMO_SECRET_KEY: 'secret',
      MOMO_REDIRECT_URL: 'https://api.example.com/api/payments/momo/return',
      MOMO_IPN_URL: 'https://api.example.com/api/payments/momo/callback',
      VNPAY_TMN_CODE: 'TMN123',
      VNPAY_HASH_SECRET: 'hash',
      VNPAY_RETURN_URL: 'https://api.example.com/api/payments/vnpay/return',
      VNPAY_IPN_URL: 'https://api.example.com/api/payments/vnpay/callback',
    });
    expect(config.payments.momo).toMatchObject({
      partnerCode: 'MOMO',
      accessKey: 'key',
      secretKey: 'secret',
      redirectUrl: 'https://api.example.com/api/payments/momo/return',
      ipnUrl: 'https://api.example.com/api/payments/momo/callback',
    });
    expect(config.payments.vnpay).toMatchObject({
      tmnCode: 'TMN123',
      hashSecret: 'hash',
      returnUrl: 'https://api.example.com/api/payments/vnpay/return',
      ipnUrl: 'https://api.example.com/api/payments/vnpay/callback',
    });
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
