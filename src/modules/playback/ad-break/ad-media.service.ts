import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';

/** A mid-roll is at most 300 s, so an MP4 well under this size; the file is held in memory while it is stored. */
export const AD_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** Ad videos the Admin uploads from the computer instead of pasting a link: stored public, played as MP4. */
@Injectable()
export class AdMediaService {
  constructor(private readonly storage: ObjectStorage) {}

  async upload(file: Express.Multer.File | undefined): Promise<{ mediaUrl: string }> {
    if (!file?.size) throw new BadRequestException('Attach an MP4 video in the "file" field');
    const kind = detectKind(safeFileName(file.originalname), file.buffer.subarray(0, 16), [FILE_KINDS.mp4]);
    const key = `ads/${randomUUID()}${kind.extensions[0]}`;
    await this.storage.putBuffer(key, file.buffer, kind.mimeType, 'public');
    return { mediaUrl: this.storage.publicUrl(key) };
  }
}
