/**
 * Every setting the API reads, parsed and checked once at start-up so a bad .env fails fast
 * instead of on the first request that needs it. Read it through the APP_CONFIG provider.
 */
export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  trustProxy: boolean;
  databaseUrl: string;
  redisUrl: string | null;
  jwt: { secret: string; accessTtlSeconds: number; refreshTtlDays: number; issuer: string; audience: string };
  rateLimit: { ttlMs: number; limit: number; authLimit: number };
  storage: {
    driver: 'local' | 's3';
    localRoot: string;
    publicBaseUrl: string;
    s3: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  };
  mail: { host: string | null; port: number; secure: boolean; user?: string; password?: string; from: string };
  media: {
    pipeline: 'ffmpeg' | 'mock';
    ffmpegPath: string;
    ffprobePath: string;
    maxUploadBytes: number;
    maxDownloadBytes: number;
    /** Lets import/HLS URLs point at private networks; only for local development. */
    allowPrivateUrls: boolean;
    concurrency: number;
  };
  schedules: { publicationSweepMs: number; overdueSweepMs: number; hlsCheckMs: number };
  briefFontPath: string | null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const PLACEHOLDER_SECRET = 'replace-with-a-long-random-string';
const MIN_SECRET_LENGTH = 32;
const MB = 1024 * 1024;

type Env = Record<string, string | undefined>;

class EnvReader {
  readonly errors: string[] = [];

  constructor(private readonly env: Env) {}

  string(key: string, fallback?: string): string {
    const value = this.env[key]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    this.errors.push(`${key} is required`);
    return '';
  }

  optional(key: string): string | undefined {
    return this.env[key]?.trim() || undefined;
  }

  int(key: string, fallback: number, min = 0): number {
    const raw = this.optional(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      this.errors.push(`${key} must be an integer >= ${min} (got "${raw}")`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.optional(key)?.toLowerCase();
    if (raw === undefined) return fallback;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    this.errors.push(`${key} must be true or false (got "${raw}")`);
    return fallback;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const raw = this.optional(key);
    if (raw === undefined) return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    this.errors.push(`${key} must be one of ${allowed.join(', ')} (got "${raw}")`);
    return fallback;
  }
}

function jwtSecret(read: EnvReader, isProduction: boolean): string {
  const secret = read.string('JWT_SECRET');
  if (isProduction && (secret === PLACEHOLDER_SECRET || secret.length < MIN_SECRET_LENGTH)) {
    read.errors.push(`JWT_SECRET must be a random string of at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  return secret;
}

function storageConfig(read: EnvReader, port: number): AppConfig['storage'] {
  const driver = read.oneOf('STORAGE_DRIVER', ['local', 's3'] as const, 'local');
  const s3 = {
    endpoint: read.optional('S3_ENDPOINT'),
    region: read.string('S3_REGION', 'auto'),
    bucket: driver === 's3' ? read.string('S3_BUCKET') : '',
    accessKeyId: driver === 's3' ? read.string('S3_ACCESS_KEY_ID') : '',
    secretAccessKey: driver === 's3' ? read.string('S3_SECRET_ACCESS_KEY') : '',
  };
  const defaultBase = driver === 'local' ? `http://localhost:${port}/media` : undefined;
  return {
    driver,
    localRoot: read.string('STORAGE_LOCAL_ROOT', 'storage'),
    publicBaseUrl: read.string('STORAGE_PUBLIC_BASE_URL', defaultBase).replace(/\/+$/, ''),
    s3,
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const read = new EnvReader(env);
  const nodeEnv = read.string('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const port = read.int('PORT', 3001, 1);

  const config: AppConfig = {
    nodeEnv,
    isProduction,
    port,
    corsOrigins: read
      .string('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    swaggerEnabled: read.bool('SWAGGER_ENABLED', !isProduction),
    trustProxy: read.bool('TRUST_PROXY', false),
    databaseUrl: read.string('DATABASE_URL'),
    redisUrl: read.optional('REDIS_URL') ?? null,
    jwt: {
      secret: jwtSecret(read, isProduction),
      accessTtlSeconds: read.int('JWT_ACCESS_TTL_SECONDS', 15 * 60, 60),
      refreshTtlDays: read.int('JWT_REFRESH_TTL_DAYS', 30, 1),
      issuer: read.string('JWT_ISSUER', 'ai-cinema-api'),
      audience: read.string('JWT_AUDIENCE', 'ai-cinema'),
    },
    rateLimit: {
      ttlMs: read.int('RATE_LIMIT_TTL_MS', 60_000, 1000),
      limit: read.int('RATE_LIMIT_MAX', 300, 1),
      authLimit: read.int('RATE_LIMIT_AUTH_MAX', 10, 1),
    },
    storage: storageConfig(read, port),
    mail: {
      host: read.optional('SMTP_HOST') ?? null,
      port: read.int('SMTP_PORT', 587, 1),
      secure: read.bool('SMTP_SECURE', false),
      user: read.optional('SMTP_USER'),
      password: read.optional('SMTP_PASSWORD'),
      from: read.string('MAIL_FROM', 'AI Cinema <no-reply@aicinema.local>'),
    },
    media: {
      pipeline: read.oneOf('MEDIA_PIPELINE', ['ffmpeg', 'mock'] as const, 'ffmpeg'),
      ffmpegPath: read.string('FFMPEG_PATH', 'ffmpeg'),
      ffprobePath: read.string('FFPROBE_PATH', 'ffprobe'),
      maxUploadBytes: read.int('MEDIA_MAX_UPLOAD_MB', 2048, 1) * MB,
      maxDownloadBytes: read.int('MEDIA_MAX_DOWNLOAD_MB', 4096, 1) * MB,
      allowPrivateUrls: read.bool('MEDIA_ALLOW_PRIVATE_URLS', false),
      concurrency: read.int('MEDIA_CONCURRENCY', 1, 1),
    },
    schedules: {
      publicationSweepMs: read.int('PUBLICATION_SWEEP_MS', 30_000),
      overdueSweepMs: read.int('OVERDUE_SWEEP_MS', 60 * 60_000),
      hlsCheckMs: read.int('HLS_CHECK_MS', 6 * 60 * 60_000),
    },
    briefFontPath: read.optional('BRIEF_FONT_PATH') ?? null,
  };

  if (isProduction && config.media.allowPrivateUrls) {
    read.errors.push('MEDIA_ALLOW_PRIVATE_URLS must stay false in production');
  }
  if (read.errors.length) {
    throw new Error(`Invalid configuration:\n- ${read.errors.join('\n- ')}`);
  }
  return Object.freeze(config);
}
