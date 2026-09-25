import { Module } from '@nestjs/common';
import { ProductionProjectController } from './production-project.controller';
import { ProductionProjectService } from './production-project.service';
import { PlatformSettingModule } from 'src/modules/platform-setting/platform-setting.module';

@Module({
  imports: [PlatformSettingModule],
  controllers: [ProductionProjectController],
  providers: [ProductionProjectService],
  exports: [ProductionProjectService],
})
export class ProductionProjectModule {}
