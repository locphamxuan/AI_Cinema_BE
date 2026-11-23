import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { UpdateStudioLegalProfileRequestDto } from './dto/studio-legal-profile.request.dto';
import { StudioProfileService } from './studio-profile.service';

/** The legal profile (Bên B) a studio keeps itself on Studio Web; only a STUDIO account reaches it. */
@ApiTags('studio-portal')
@ApiBearerAuth()
@Controller('studio-portal/profile')
@RequirePermission(PERMISSION.STUDIO_PORTAL)
export class StudioProfileController {
  constructor(private readonly profiles: StudioProfileService) {}

  @Get()
  @ApiOperation({ summary: 'The legal profile of this studio, with the fields still missing before it can sign' })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.get(user);
  }

  @Put()
  @ApiOperation({ summary: 'Fill in or correct the legal profile of this studio (Bên B of its contracts)' })
  update(@Body() dto: UpdateStudioLegalProfileRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.profiles.update(user, dto);
  }
}
