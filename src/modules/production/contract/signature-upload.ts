import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { SIGNATURE_BODY, SIGNATURE_OPTIONAL_COST_BODY, SIGNATURE_WITH_COST_BODY } from './dto/contract.request.dto';
import { SIGNATURE_MAX_BYTES } from './signature-image';

const BODIES = { none: SIGNATURE_BODY, required: SIGNATURE_WITH_COST_BODY, optional: SIGNATURE_OPTIONAL_COST_BODY };

/**
 * The `file` field of a signing endpoint: one signature image (PNG/JPEG), kept in memory so it can be checked
 * before anything is stored. memoryStorage is named on purpose — the studio portal also registers a disk-backed
 * MulterModule for episode videos, which would otherwise swallow the buffer.
 */
export function SignatureUpload(cost: keyof typeof BODIES = 'none') {
  return applyDecorators(
    UseInterceptors(
      FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: SIGNATURE_MAX_BYTES, files: 1 } }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody(BODIES[cost]),
  );
}
