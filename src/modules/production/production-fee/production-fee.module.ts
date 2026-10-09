import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { ReviewerTokenModule } from 'src/modules/production/reviewer-token/reviewer-token.module';
import { ProductionFeeController } from './production-fee.controller';
import { ProductionFeeService } from './production-fee.service';

@Module({
  imports: [PlatformSettingModule, ReviewerTokenModule],
  controllers: [ProductionFeeController],
  providers: [ProductionFeeService],
  exports: [ProductionFeeService],
})
export class ProductionFeeModule {}
