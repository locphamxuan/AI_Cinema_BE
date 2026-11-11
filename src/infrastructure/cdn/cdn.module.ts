import { Global, Module } from '@nestjs/common';
import { CdnPurgeService } from './cdn-purge.service';

/** Global like StorageModule: the CDN sits next to the object store, not inside one feature. */
@Global()
@Module({
  providers: [CdnPurgeService],
  exports: [CdnPurgeService],
})
export class CdnModule {}
