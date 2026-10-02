import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from 'src/config/app-config';
import { assertSafeKey, ObjectStorage, type Visibility } from './object-storage';

/**
 * S3-compatible bucket (Cloudflare R2, AWS S3, MinIO). Public objects sit under "public/",
 * the only prefix the CDN in front of STORAGE_PUBLIC_BASE_URL may expose; private objects
 * sit under "private/" and are only read by the API.
 */
export class S3ObjectStorage extends ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: AppConfig['storage']) {
    super();
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async putBuffer(key: string, body: Buffer, contentType: string, visibility: Visibility): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, visibility),
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async putFile(key: string, localPath: string, contentType: string, visibility: Visibility): Promise<void> {
    const { size } = await stat(localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, visibility),
        Body: createReadStream(localPath),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  async read(key: string, visibility: Visibility): Promise<Buffer> {
    const body = await this.body(key, visibility);
    return Buffer.from(await body.transformToByteArray());
  }

  async stream(key: string, visibility: Visibility): Promise<Readable> {
    const body = await this.body(key, visibility);
    return Readable.fromWeb(body.transformToWebStream() as Parameters<typeof Readable.fromWeb>[0]);
  }

  async remove(key: string, visibility: Visibility): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }));
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${this.objectKey(key, 'public')}`;
  }

  private async body(key: string, visibility: Visibility) {
    const { Body } = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }),
    );
    if (!Body) throw new Error(`Object ${key} is empty`);
    return Body;
  }

  private objectKey(key: string, visibility: Visibility): string {
    assertSafeKey(key);
    return `${visibility}/${key}`;
  }
}
