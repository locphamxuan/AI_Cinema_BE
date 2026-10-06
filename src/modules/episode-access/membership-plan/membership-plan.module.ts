import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { MembershipPlanController } from './membership-plan.controller';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipPlanAdminController } from 'src/modules/episode-access/membership-plan/admin-membership-plan.controller';

/** The plan catalogue: the public price list and the Admin screen that maintains it. */
@Module({
  imports: [AuditLogModule],
  controllers: [MembershipPlanController, MembershipPlanAdminController],
  providers: [MembershipPlanService],
  exports: [MembershipPlanService],
})
export class MembershipPlanModule {}
