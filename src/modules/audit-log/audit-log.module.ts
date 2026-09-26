import { Controller, Get, Global, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AuditEventInterceptor } from './audit-event.interceptor';
import { AuditLogService } from './audit-log.service';

@ApiTags('audit-log')
@ApiBearerAuth()
@Controller()
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  /** The project's production events (§4.1.4), newest first. */
  @Get('production-projects/:projectId/events')
  @RequirePermission(PERMISSION.PRODUCTION_READ)
  findForProject(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.auditLog.findForProject(projectId);
  }
}

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, { provide: APP_INTERCEPTOR, useClass: AuditEventInterceptor }],
  exports: [AuditLogService],
})
export class AuditLogModule {}
