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
  // Reviewers need the rates and the valid price range while funding and pricing: since 07/11/2026 pricing
  // is `episode:price` (Reviewer) and publishing `episode:publish` (Admin), so both open the settings.
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE, PERMISSION.EPISODE_PUBLISH, PERMISSION.EPISODE_PRICE)
  async get() {
    return this.platformSettingService.get();
  }

  @Patch()
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE)
  async update(@Body() dto: UpdatePlatformSettingRequestDto, @CurrentUser('id') userId: string) {
    return this.platformSettingService.update(dto, userId);
  }
}
