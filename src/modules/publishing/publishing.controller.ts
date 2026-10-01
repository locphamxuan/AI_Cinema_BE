import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PublishEpisodeRequestDto, SetCoinPriceRequestDto, UnpublishRequestDto } from './dto/publishing.request.dto';
import { PricingService } from './pricing.service';
import { PublicationService } from './publication.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('publishing')
@ApiBearerAuth()
@Controller()
export class PublishingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly publications: PublicationService,
  ) {}

  @Patch('episodes/:episodeId/coin-price')
  @RequirePermission(PERMISSION.EPISODE_PUBLISH)
  @ApiOperation({ summary: 'Set the Coin price; outside the Admin range it is kept and flagged (BR-29, BR-47)' })
  setPrice(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: SetCoinPriceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pricing.setPrice(episodeId, dto.coinPrice, user);
  }

  @Get('episodes/:episodeId/publications')
  @ApiOperation({ summary: 'Every release of an episode, newest first' })
  list(@Param('episodeId', ID) episodeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.publications.list(episodeId, user);
  }

  @Post('episodes/:episodeId/publications')
  @RequirePermission(PERMISSION.EPISODE_PUBLISH)
  @ApiOperation({ summary: 'Publish now, or schedule (again) at scheduledAt (steps 12–14, BR-19)' })
  publish(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: PublishEpisodeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.publications.publish(episodeId, dto, user);
  }

  @Post('publications/:publicationId/unpublish')
  @HttpCode(200)
  @RequirePermission(PERMISSION.EPISODE_PUBLISH)
  @ApiOperation({ summary: 'Take a published episode down, or cancel a scheduled release' })
  unpublish(
    @Param('publicationId', ID) publicationId: string,
    @Body() dto: UnpublishRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.publications.unpublish(publicationId, dto, user);
  }
}
