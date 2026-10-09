import { Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AccessControlService } from './access-control.service';
import { SetRolePermissionsRequestDto } from './dto/set-role-permissions.request.dto';

@ApiTags('access-control')
@ApiBearerAuth()
@RequirePermission(PERMISSION.ROLE_MANAGE)
@Controller()
export class AccessControlController {
  constructor(private readonly accessControl: AccessControlService) {}

  @Get('permissions')
  async listPermissions() {
    return this.accessControl.listPermissions();
  }

  @Get('roles')
  async listRoles() {
    return this.accessControl.listRoles();
  }

  @Put('roles/:role/permissions')
  async setRolePermissions(
    @Param('role', new ParseEnumPipe(UserRole)) role: UserRole,
    @Body() dto: SetRolePermissionsRequestDto,
  ) {
    return this.accessControl.setRolePermissions(role, dto.permissions);
  }
}
