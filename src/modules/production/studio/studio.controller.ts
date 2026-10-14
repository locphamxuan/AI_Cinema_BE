import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CreateStudioRequestDto, StudioListQueryDto, UpdateStudioRequestDto } from './dto/studio.request.dto';
import { StudioService } from './studio.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** Catalog of partner studios (BR-59): the Reviewer keeps it, the Creator picks from it at hand-off. */
@ApiTags('studios')
@ApiBearerAuth()
@Controller('studios')
export class StudioController {
  constructor(private readonly studios: StudioService) {}

  @Get()
  @RequirePermission(PERMISSION.STUDIO_MANAGE, PERMISSION.STUDIO_HANDOFF, PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Studios by name; ?active=true lists only those that can take a project' })
  list(@Query() query: StudioListQueryDto) {
    return this.studios.list(query.active);
  }

  @Get(':studioId')
  @RequirePermission(PERMISSION.STUDIO_MANAGE, PERMISSION.STUDIO_HANDOFF, PERMISSION.PROJECT_MANAGE)
  detail(@Param('studioId', ID) studioId: string) {
    return this.studios.detail(studioId);
  }

  @Post()
  @RequirePermission(PERMISSION.STUDIO_MANAGE)
  @ApiOperation({ summary: 'Add a studio to the catalog; its email must be unique' })
  create(@Body() dto: CreateStudioRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.studios.create(dto, user);
  }

  @Patch(':studioId')
  @RequirePermission(PERMISSION.STUDIO_MANAGE)
  @ApiOperation({ summary: 'Edit a studio or deactivate it (isActive: false)' })
  update(
    @Param('studioId', ID) studioId: string,
    @Body() dto: UpdateStudioRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.studios.update(studioId, dto, user);
  }

  @Delete(':studioId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION.STUDIO_MANAGE)
  @ApiOperation({ summary: 'Delete a studio that never took a project; otherwise deactivate it' })
  remove(@Param('studioId', ID) studioId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.studios.remove(studioId, user);
  }
}
