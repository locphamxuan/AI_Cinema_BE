import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdatePlatformSettingRequestDto } from './dto/update-platform-setting.request.dto';
import { PlatformSettingService } from './platform-setting.service';

@ApiTags('platform-settings')
@ApiBearerAuth()
// Served on both paths: MF-2 Admin clients use `admin/platform-settings`, older callers the plain one.
@Controller(['platform-settings', 'admin/platform-settings'])
export class PlatformSettingController {
  constructor(private readonly platformSettingService: PlatformSettingService) {}

  @Get()
  // Since 2026-11-11 pricing (`episode:price`) belongs to the Admin alone; the Reviewer still reads
  // the rates while funding a project (`production:cost.request`), so both roles open the settings.
  @RequirePermission(
    PERMISSION.PLATFORM_SETTINGS_MANAGE,
    PERMISSION.EPISODE_PUBLISH,
    PERMISSION.EPISODE_PRICE,
    PERMISSION.COST_REQUEST,
  )
  async get() {
    return this.platformSettingService.get();
  }

  @Patch()
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE)
  async update(@Body() dto: UpdatePlatformSettingRequestDto, @CurrentUser('id') userId: string) {
    return this.platformSettingService.update(dto, userId);
  }
}
