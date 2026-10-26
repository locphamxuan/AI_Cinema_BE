import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AdCatalogService } from './ad-catalog.service';
import { AD_VIDEO_MAX_BYTES, AdMediaService } from './ad-media.service';
import { AdViewDto } from 'src/modules/playback/ad-break/dto/ad.view.dto';
import { CreateAdRequestDto } from 'src/modules/playback/ad-break/dto/create-ad.request.dto';
import { UpdateAdRequestDto } from 'src/modules/playback/ad-break/dto/update-ad.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });
const VIDEO = FileInterceptor('file', { limits: { fileSize: AD_VIDEO_MAX_BYTES, files: 1 } });

@ApiTags('admin-ads')
@ApiBearerAuth()
@Controller('admin/ads')
export class AdCatalogController {
  constructor(
    private readonly catalog: AdCatalogService,
    private readonly media: AdMediaService,
  ) {}

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

  @Post('media')
  @RequirePermission(PERMISSION.AD_MANAGE)
  @UseInterceptors(VIDEO)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Upload an ad video from the computer (MP4, ≤ 100 MB); answers the mediaUrl to create the ad with',
  })
  uploadMedia(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.media.upload(file);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION.AD_MANAGE)
  @ApiOperation({ summary: 'Edit an ad, pause it or resume it' })
  @ApiOkResponse({ type: AdViewDto })
  update(@Param('id', ID) id: string, @Body() dto: UpdateAdRequestDto) {
    return this.catalog.update(id, dto);
  }
}
