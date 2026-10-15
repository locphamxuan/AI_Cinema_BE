import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AdCatalogService } from './ad-catalog.service';
import { AdViewDto, CreateAdRequestDto, UpdateAdRequestDto } from './dto/ad.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-ads')
@ApiBearerAuth()
@Controller('admin/ads')
export class AdCatalogController {
  constructor(private readonly catalog: AdCatalogService) {}

  @Get()
  @RequirePermission(PERMISSION.AD_MANAGE)
  @ApiOperation({ summary: 'Every ad, paused ones included' })
  ads(@Paginate() query: PaginateQuery) {
    return this.catalog.ads(query);
  }

  @Post()
  @RequirePermission(PERMISSION.AD_MANAGE)
  @ApiOperation({ summary: 'Create an ad for the mid-roll draw' })
  @ApiOkResponse({ type: AdViewDto })
  create(@Body() dto: CreateAdRequestDto) {
    return this.catalog.create(dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION.AD_MANAGE)
  @ApiOperation({ summary: 'Edit an ad, pause it or resume it' })
  @ApiOkResponse({ type: AdViewDto })
  update(@Param('id', ID) id: string, @Body() dto: UpdateAdRequestDto) {
    return this.catalog.update(id, dto);
  }
}
