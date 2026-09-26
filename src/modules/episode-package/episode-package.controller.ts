import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateEpisodePackageRequestDto } from './dto/create-episode-package.request.dto';
import { EpisodePackageService } from './episode-package.service';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('episode-packages')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class EpisodePackageController {
  constructor(private readonly episodePackageService: EpisodePackageService) {}

  @Post('production-plans/:planId/episode-packages')
  @Audit.episodeAssembled()
  @RequirePermission(PERMISSION.EPISODE_SUBMIT)
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

  @Get('episode-packages/:packageId/subtitles/:language')
  @Header('Content-Type', 'text/vtt; charset=utf-8')
  async findSubtitle(@Param('packageId') packageId: string, @Param('language') language: string) {
    return this.episodePackageService.findSubtitle(packageId, language);
  }
}
