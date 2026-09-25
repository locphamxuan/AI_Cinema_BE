import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdatePlatformSettingRequestDto } from './dto/update-platform-setting.request.dto';
import { PlatformSettingService } from './platform-setting.service';

@ApiTags('platform-settings')
@ApiBearerAuth()
@Controller('platform-settings')
export class PlatformSettingController {
  constructor(private readonly platformSettingService: PlatformSettingService) {}

  @Get()
  @RequirePermission(PERMISSION.PRODUCTION_READ)
  async get() {
    return this.platformSettingService.get();
  }

  @Patch()
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE)
  async update(@Body() dto: UpdatePlatformSettingRequestDto, @CurrentUser('id') userId: string) {
    return this.platformSettingService.update(dto, userId);
  }
}
