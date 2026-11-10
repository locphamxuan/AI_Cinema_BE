import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CONTRACT_PDF_MAX_BYTES } from './contract-signature.service';
import { SIGNED_PDF_BODY, SIGNED_PDF_WITH_COST_BODY } from './dto/contract.request.dto';

/**
 * The `file` field of a signing endpoint: one signed contract PDF, kept in memory so it can be checked and
 * merged before anything is stored. memoryStorage is named on purpose — the studio portal also registers a
 * disk-backed MulterModule for episode videos, which would otherwise swallow the buffer.
 */
export function SignedPdfUpload(withCost = false) {
  return applyDecorators(
    UseInterceptors(
      FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: CONTRACT_PDF_MAX_BYTES, files: 1 } }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody(withCost ? SIGNED_PDF_WITH_COST_BODY : SIGNED_PDF_BODY),
  );
}
