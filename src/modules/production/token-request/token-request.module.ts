import { Module } from '@nestjs/common';
import { ProductionFeeModule } from 'src/modules/production/production-fee/production-fee.module';
import { TokenRequestController } from './token-request.controller';
import { TokenRequestService } from './token-request.service';

@Module({
  imports: [ProductionFeeModule],
  controllers: [TokenRequestController],
  providers: [TokenRequestService],
})
export class TokenRequestModule {}
