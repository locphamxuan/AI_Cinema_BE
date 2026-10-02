import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [PlatformSettingModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
