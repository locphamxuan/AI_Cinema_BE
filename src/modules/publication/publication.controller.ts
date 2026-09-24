import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreatePublicationRequestDto } from './dto/create-publication.request.dto';
import { PublicationService } from './publication.service';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('publications')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class PublicationController {
  constructor(private readonly publicationService: PublicationService) {}

  @Post('episodes/:episodeId/publications')
  @Roles(...REVIEWER_ROLES)
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
  @Roles(...REVIEWER_ROLES)
  async publish(@Param('publicationId') publicationId: string) {
    return this.publicationService.publish(publicationId);
  }

  @Post('publications/:publicationId/unpublish')
  @Roles(...REVIEWER_ROLES)
  async unpublish(@Param('publicationId') publicationId: string) {
    return this.publicationService.unpublish(publicationId);
  }
}
