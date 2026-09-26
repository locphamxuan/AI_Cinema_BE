import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreatePublicationRequestDto } from './dto/create-publication.request.dto';
import { PublicationService } from './publication.service';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('publications')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class PublicationController {
  constructor(private readonly publicationService: PublicationService) {}

  @Post('episodes/:episodeId/publications')
  @Audit.episodeScheduled()
  @RequirePermission(PERMISSION.MOVIE_PUBLISH)
  async create(
    @Param('episodeId') episodeId: string,
    @Body() dto: CreatePublicationRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.publicationService.create(episodeId, dto, userId);
  }

  @Get('episodes/:episodeId/publications')
  async findAll(@Param('episodeId') episodeId: string) {
    return this.publicationService.findAll(episodeId);
  }

  @Post('publications/:publicationId/publish')
  @Audit.episodePublished()
  @RequirePermission(PERMISSION.MOVIE_PUBLISH)
  async publish(@Param('publicationId') publicationId: string) {
    return this.publicationService.publish(publicationId);
  }

  @Post('publications/:publicationId/unpublish')
  @Audit.episodeUnpublished()
  @RequirePermission(PERMISSION.MOVIE_PUBLISH)
  async unpublish(@Param('publicationId') publicationId: string) {
    return this.publicationService.unpublish(publicationId);
  }
}
