import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

/**
 * S3-compatible bucket (Cloudflare R2, Supabase Storage, AWS S3, MinIO) holding the
 * audio/video a provider returns as raw bytes. Images stay on the provider's CDN.
 */
@Injectable()
export class MediaStorage {
  private readonly client: S3Client | null;
  private readonly bucket: string | undefined;
  private readonly publicBaseUrl: string | undefined;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT');
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('S3_BUCKET');
    this.publicBaseUrl = config.get<string>('S3_PUBLIC_BASE_URL')?.replace(/\/+$/, '');
    this.client =
      accessKeyId && secretAccessKey && this.bucket && this.publicBaseUrl
        ? new S3Client({
            endpoint,
            region: config.get<string>('S3_REGION') ?? 'auto',
            forcePathStyle: Boolean(endpoint),
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Uploads the bytes and returns the public URL the players load. */
  async upload(bytes: Uint8Array, mimeType: string, extension: string): Promise<string> {
    if (!this.client) {
      throw new Error(
        'Media storage is not configured: set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_PUBLIC_BASE_URL',
      );
    }
    const key = `generated/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mimeType }));
    return `${this.publicBaseUrl}/${key}`;
  }
}
