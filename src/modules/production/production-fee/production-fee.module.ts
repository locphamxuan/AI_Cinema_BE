import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { ProductionFeeController } from './production-fee.controller';
import { ProductionFeeService } from './production-fee.service';

@Module({
  imports: [PlatformSettingModule],
  controllers: [ProductionFeeController],
  providers: [ProductionFeeService],
  exports: [ProductionFeeService],
})
export class ProductionFeeModule {}
