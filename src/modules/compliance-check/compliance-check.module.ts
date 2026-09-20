import { Module } from '@nestjs/common';
import { ComplianceCheckController } from './compliance-check.controller';
import { ComplianceCheckService } from './compliance-check.service';

@Module({
  controllers: [ComplianceCheckController],
  providers: [ComplianceCheckService],
})
export class ComplianceCheckModule {}
