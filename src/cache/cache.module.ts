import { Global, Module } from '@nestjs/common';
import { CacheService } from 'src/cache/cache.service';

@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
