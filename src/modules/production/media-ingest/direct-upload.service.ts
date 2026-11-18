import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, type FileKind } from 'src/common/validation/uploaded-file';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { removeQuietly } from 'src/infrastructure/storage/remove-quietly';
import type { CompleteDirectUploadRequestDto, StartDirectUploadRequestDto } from './dto/direct-upload.request.dto';
import { MediaIngestService } from './media-ingest.service';
import { VIDEO_KINDS } from './pipeline/media-pipeline.service';

/** How long the signed PUT URL and its token stay valid. */
export const UPLOAD_TTL_SECONDS = 15 * 60;
/**
 * Where browser uploads land before they are checked. The bucket expires this prefix after a day (R2 lifecycle
 * rule on `private/uploads/`), so an upload the studio never completed does not stay behind.
 */
export const UPLOAD_PREFIX = 'uploads';

interface UploadClaim {
  uploadId: string;
  episodeId: string;
  userId: string;
  ext: string;
  sizeBytes: number;
  exp: number;
}

/**
 * The film of an episode sent from the browser straight to the bucket (presigned PUT), so gigabytes never pass
 * through the API or a proxy body limit. Step 1 checks who may deliver what and signs the URL; step 3 checks the
 * object really is that film before it becomes a version, exactly as the multipart route would.
 */
@Injectable()
export class DirectUploadService {
  constructor(
    private readonly ingest: MediaIngestService,
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async start(episodeId: string, dto: StartDirectUploadRequestDto, user: AuthenticatedUser) {
    await this.ingest.assertCanSubmit(episodeId, user);
    const kind = kindOf(dto.fileName);
    if (dto.sizeBytes > this.config.media.maxUploadBytes) {
      throw new BadRequestException(`The film is larger than ${this.config.media.maxUploadBytes} bytes`);
    }
    const claim: UploadClaim = {
      uploadId: randomUUID(),
      episodeId,
      userId: user.id,
      ext: kind.extensions[0],
      sizeBytes: dto.sizeBytes,
      exp: Date.now() + UPLOAD_TTL_SECONDS * 1000,
    };
    const uploadUrl = await this.storage.presignPut(stagingKey(claim), kind.mimeType, 'private', UPLOAD_TTL_SECONDS);
    if (!uploadUrl) {
      throw new NotImplementedException({
        message: 'This storage cannot take direct uploads; send the file to /media/upload',
        details: { reason: 'DIRECT_UPLOAD_UNSUPPORTED' },
      });
    }
    return {
      uploadId: claim.uploadId,
      uploadUrl,
      headers: { 'Content-Type': kind.mimeType },
      uploadToken: this.sign(claim),
      expiresAt: new Date(claim.exp).toISOString(),
    };
  }

  async complete(episodeId: string, dto: CompleteDirectUploadRequestDto, user: AuthenticatedUser) {
    const claim = this.verify(dto.uploadToken, episodeId, user.id);
    const staged = stagingKey(claim);
    const stored = await this.storage.stat(staged, 'private');
    if (!stored) throw new BadRequestException('The film has not been uploaded yet, or the upload expired');
    try {
      if (stored.size !== claim.sizeBytes) throw new BadRequestException('The uploaded film is not the size announced');
      detectKind(`source${claim.ext}`, await this.storage.readHead(staged, 'private', 16), VIDEO_KINDS);
      await this.ingest.assertCanSubmit(episodeId, user);
    } catch (error) {
      await removeQuietly(this.storage, staged, 'private');
      throw error;
    }
    const storageKey = `media/${claim.uploadId}/source${claim.ext}`;
    await this.storage.move(staged, storageKey, 'private');
    return this.ingest.registerUpload(
      episodeId,
      user,
      { id: claim.uploadId, storageKey, sizeBytes: stored.size },
      dto,
      dto.aiDisclosure,
    );
  }

  private sign(claim: UploadClaim): string {
    const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  private verify(token: string, episodeId: string, userId: string): UploadClaim {
    const [body, mac] = token.split('.');
    const expected = body ? this.mac(body) : '';
    const valid = !!mac && mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
    const claim = valid ? (JSON.parse(Buffer.from(body, 'base64url').toString()) as UploadClaim) : null;
    if (!claim || claim.episodeId !== episodeId || claim.userId !== userId) {
      throw new BadRequestException('The upload token is not valid for this episode');
    }
    if (claim.exp < Date.now()) throw new BadRequestException('The upload expired; start it again');
    return claim;
  }

  private mac(body: string): string {
    return createHmac('sha256', this.config.jwt.secret).update(`direct-upload:${body}`).digest('base64url');
  }
}

const stagingKey = (claim: Pick<UploadClaim, 'uploadId' | 'ext'>) =>
  `${UPLOAD_PREFIX}/${claim.uploadId}/source${claim.ext}`;

/** MP4 or MOV by its name; the bytes are checked once uploaded. */
function kindOf(fileName: string): FileKind {
  const lower = fileName.toLowerCase();
  const kind = VIDEO_KINDS.find((k) => k.extensions.some((ext) => lower.endsWith(ext)));
  if (!kind) throw new BadRequestException('The film must be an MP4 or MOV file');
  return kind;
}
