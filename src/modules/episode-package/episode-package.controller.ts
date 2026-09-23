import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateEpisodePackageRequestDto } from './dto/create-episode-package.request.dto';
import { EpisodePackageService } from './episode-package.service';

@ApiTags('episode-packages')
@ApiBearerAuth()
@Controller()
export class EpisodePackageController {
  constructor(private readonly episodePackageService: EpisodePackageService) {}

  @Post('production-plans/:planId/episode-packages')
  async assemble(
    @Param('planId') planId: string,
    @Body() dto: CreateEpisodePackageRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.episodePackageService.assemble(planId, dto, userId);
  }

  @Get('production-plans/:planId/episode-packages')
  async findAll(@Param('planId') planId: string) {
    return this.episodePackageService.findAll(planId);
  }

  @Get('episode-packages/:packageId')
  async findById(@Param('packageId') packageId: string) {
    return this.episodePackageService.findById(packageId);
  }
}
