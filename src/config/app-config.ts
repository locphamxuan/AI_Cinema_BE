import { cdnConfig, type CdnConfig } from './cdn-config';
import { EnvReader, type Env } from './env-reader';
import { DEFAULT_CODE_TTL_SECONDS, type OAuthConfig } from './oauth-config';
import { supportConfig, type SupportConfig } from './support-config';

/**
 * Every setting the API reads, parsed and checked once at start-up so a bad .env fails fast
 * instead of on the first request that needs it. Read it through the APP_CONFIG provider.
 */
export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  /** Studio Web origin, for the links in the emails a studio receives. */
  studioWebUrl: string;
  /** Where the payment return trip sends the member: the mobile app's top-up screen. */
  appReturnUrl: string;
  swaggerEnabled: boolean;
  trustProxy: boolean;
  databaseUrl: string;
  redisUrl: string | null;
  jwt: { secret: string; accessTtlSeconds: number; refreshTtlDays: number; issuer: string; audience: string };
  rateLimit: {
    ttlMs: number;
    limit: number;
    authLimit: number;
    /** MF-3: opening a playback session (flow 3, step 11); a deliberate tap, kept tight. */
    playbackSessionLimit: number;
    /** MF-3: heartbeats; a viewer sends 4–6/min and CGNAT puts many viewers on one IP. */
    playbackHeartbeatLimit: number;
  };
  /** Absolute base players resolve API-issued playlist URLs against. */
  apiPublicUrl: string;
  storage: {
    driver: 'local' | 's3';
    localRoot: string;
    publicBaseUrl: string;
    s3: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  };
  /** Cloudflare R2 + CDN in front of the HLS output; falls back to the storage origin. */
  cdn: CdnConfig;
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
  schedules: {
    publicationSweepMs: number;
    overdueSweepMs: number;
    hlsCheckMs: number;
    /** MF-2: subscription auto-renew, bonus lot expiry, top-up expiry and reconciliation. */
    subscriptionRenewalSweepMs: number;
    coinExpirySweepMs: number;
    coinTopUpSweepMs: number;
    paymentReconcileSweepMs: number;
    /** MF-3: closing sessions whose heartbeat timed out. */
    streamingSessionSweepMs: number;
    /** MF-3: deleting finished sessions older than `playback.sessionRetentionDays`. */
    streamingSessionRetentionSweepMs: number;
  };
  /**
   * Real payment gateways (MF-2 top-ups). Secrets are optional: a provider with no
   * credentials is treated as not configured and its top-ups are refused at request
   * time, so local development boots without any gateway account.
   */
  payments: {
    vnpay: {
      tmnCode?: string;
      hashSecret?: string;
      payUrl: string;
      returnUrl?: string;
      ipnUrl?: string;
      apiUrl: string;
    };
  };
  briefFontPath: string | null;
  /**
   * MF-3 playback: signed URLs and session retention. Empty `urlSecret` = signing disabled:
   * the API hands out direct stream URLs and the token playlist endpoints refuse with 422,
   * so local development boots without any secret.
   */
  playback: {
    urlSecret?: string;
    /**
     * Lifetime of a signed URL. Playlist responses re-sign their child URLs on every serve,
     * so this bounds a leaked link rather than an actively playing session.
     * Keep it inside the 30–60 minute window.
     */
    urlTtlSeconds: number;
    /**
     * MF-3 retention: a session that ended more than this many days ago is deleted by the
     * retention sweep, and its ad-break rows cascade with it. 0 keeps every row forever;
     * keep the window longer than any report that reads session rows.
     */
    sessionRetentionDays: number;
  };
  /** Google Sign-In (OIDC). Empty clientIds = provider disabled. */
  google: { clientIds: string[] };
  /** AI customer support: provider, RAG and case-handling settings (src/config/support-config.ts). */
  support: SupportConfig;
  /** AI Cinema as an OAuth 2.0 authorization server for Studio Web (src/config/oauth-config.ts). */
  oauth: OAuthConfig;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const PLACEHOLDER_SECRET = 'replace-with-a-long-random-string';
const MIN_SECRET_LENGTH = 32;
const MB = 1024 * 1024;

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

function paymentConfig(read: EnvReader): AppConfig['payments'] {
  return {
    vnpay: {
      tmnCode: read.optional('VNPAY_TMN_CODE'),
      hashSecret: read.optional('VNPAY_HASH_SECRET'),
      payUrl: read.string('VNPAY_PAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
      returnUrl: read.optional('VNPAY_RETURN_URL'),
      ipnUrl: read.optional('VNPAY_IPN_URL'),
      apiUrl: read.string('VNPAY_API_URL', 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
    },
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const read = new EnvReader(env);
  const nodeEnv = read.string('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const port = read.int('PORT', 3001, 1);
  const storage = storageConfig(read, port);

  const config: AppConfig = {
    nodeEnv,
    isProduction,
    port,
    corsOrigins: read
      .string('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    studioWebUrl: read.string('STUDIO_WEB_URL', 'http://localhost:3100'),
    appReturnUrl: read.string('APP_RETURN_URL', 'aicinema://top-ups'),
    swaggerEnabled: read.bool('SWAGGER_ENABLED', !isProduction),
    trustProxy: read.bool('TRUST_PROXY', false),
    databaseUrl: read.string('DATABASE_URL'),
    redisUrl: read.optional('REDIS_URL') ?? null,
    jwt: {
      secret: jwtSecret(read, isProduction),
      accessTtlSeconds: read.int('JWT_ACCESS_TTL_SECONDS', 30 * 60, 60),
      refreshTtlDays: read.int('JWT_REFRESH_TTL_DAYS', 30, 1),
      issuer: read.string('JWT_ISSUER', 'ai-cinema-api'),
      audience: read.string('JWT_AUDIENCE', 'ai-cinema'),
    },
    rateLimit: {
      ttlMs: read.int('RATE_LIMIT_TTL_MS', 60_000, 1000),
      limit: read.int('RATE_LIMIT_MAX', 300, 1),
      authLimit: read.int('RATE_LIMIT_AUTH_MAX', 10, 1),
      // Beating players sit behind shared CGNAT IPs: the heartbeat budget covers ~200
      // concurrent viewers (6 req/min each) while session creation is tightened so guest
      // minting cannot ride the API-wide budget.
      playbackSessionLimit: read.int('RATE_LIMIT_PLAYBACK_SESSION_MAX', 60, 1),
      playbackHeartbeatLimit: read.int('RATE_LIMIT_PLAYBACK_HEARTBEAT_MAX', 1200, 1),
    },
    apiPublicUrl: (read.optional('API_PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    storage,
    cdn: cdnConfig(read, storage.publicBaseUrl),
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
      subscriptionRenewalSweepMs: read.int('SUBSCRIPTION_RENEWAL_SWEEP_MS', 60_000),
      coinExpirySweepMs: read.int('COIN_EXPIRY_SWEEP_MS', 24 * 60 * 60_000),
      coinTopUpSweepMs: read.int('COIN_TOPUP_SWEEP_MS', 5 * 60_000),
      paymentReconcileSweepMs: read.int('PAYMENT_RECONCILE_SWEEP_MS', 10 * 60_000),
      /** MF-3: sessions whose heartbeat timed out are closed and their progress saved. */
      streamingSessionSweepMs: read.int('STREAMING_SESSION_SWEEP_MS', 30_000),
      /** MF-3: the retention sweep runs once a day by default; it is cheap when nothing is due. */
      streamingSessionRetentionSweepMs: read.int('STREAMING_SESSION_RETENTION_SWEEP_MS', 24 * 60 * 60_000),
    },
    payments: paymentConfig(read),
    briefFontPath: read.optional('BRIEF_FONT_PATH') ?? null,
    playback: {
      urlSecret: read.optional('PLAYBACK_URL_SECRET'),
      urlTtlSeconds: read.int('PLAYBACK_URL_TTL_SECONDS', 3600, 60),
      sessionRetentionDays: read.int('STREAMING_SESSION_RETENTION_DAYS', 90, 0),
    },
    support: supportConfig(read),
    oauth: { codeTtlSeconds: read.int('OAUTH_CODE_TTL_SECONDS', DEFAULT_CODE_TTL_SECONDS, 30) },
    google: {
      clientIds: [
        ...new Set(
          [
            read.optional('GOOGLE_WEB_CLIENT_ID'),
            read.optional('GOOGLE_ANDROID_CLIENT_ID'),
            read.optional('GOOGLE_IOS_CLIENT_ID'),
          ].filter((value): value is string => Boolean(value)),
        ),
      ],
    },
  };

  if (isProduction && config.media.allowPrivateUrls) {
    read.errors.push('MEDIA_ALLOW_PRIVATE_URLS must stay false in production');
  }
  if (read.errors.length) {
    throw new Error(`Invalid configuration:\n- ${read.errors.join('\n- ')}`);
  }
  return Object.freeze(config);
}
