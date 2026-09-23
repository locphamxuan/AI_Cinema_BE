import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreatePublicationRequestDto } from './dto/create-publication.request.dto';
import { PublicationService } from './publication.service';

@ApiTags('publications')
@ApiBearerAuth()
@Controller()
export class PublicationController {
  constructor(private readonly publicationService: PublicationService) {}

  @Post('episodes/:episodeId/publications')
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
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
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
  async publish(@Param('publicationId') publicationId: string) {
    return this.publicationService.publish(publicationId);
  }

  @Post('publications/:publicationId/unpublish')
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
  async unpublish(@Param('publicationId') publicationId: string) {
    return this.publicationService.unpublish(publicationId);
  }
}
