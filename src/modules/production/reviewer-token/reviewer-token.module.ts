import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { AdminReviewerTokenController, ReviewerTokenController } from './reviewer-token.controller';
import { ReviewerTokenService } from './reviewer-token.service';

@Module({
  imports: [PlatformSettingModule],
  controllers: [ReviewerTokenController, AdminReviewerTokenController],
  providers: [ReviewerTokenService],
  exports: [ReviewerTokenService],
})
export class ReviewerTokenModule {}
