import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePublicationRequestDto } from './dto/create-publication.request.dto';
import { PublicationService } from './publication.service';

@ApiTags('publications')
@Controller()
export class PublicationController {
  constructor(private readonly publicationService: PublicationService) {}

  @Post('episodes/:episodeId/publications')
  async create(@Param('episodeId') episodeId: string, @Body() dto: CreatePublicationRequestDto) {
    return this.publicationService.create(episodeId, dto);
  }

  @Get('episodes/:episodeId/publications')
  async findAll(@Param('episodeId') episodeId: string) {
    return this.publicationService.findAll(episodeId);
  }

  @Post('publications/:publicationId/publish')
  async publish(@Param('publicationId') publicationId: string) {
    return this.publicationService.publish(publicationId);
  }

  @Post('publications/:publicationId/unpublish')
  async unpublish(@Param('publicationId') publicationId: string) {
    return this.publicationService.unpublish(publicationId);
  }
}
