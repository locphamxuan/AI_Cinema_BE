import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PurchaseResultDto } from './dto/purchase-result.dto';
import { EpisodePurchaseService } from './episode-purchase.service';
import { IdempotencyKey } from 'src/common/decorators/idempotency-key.decorator';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('episode-access')
@ApiBearerAuth()
@Controller('episodes')
export class EpisodePurchaseController {
  constructor(private readonly purchases: EpisodePurchaseService) {}

  @Post(':episodeId/purchase')
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'Unlock one episode with Coin; main Coins are taken before bonus Coins' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Sending it twice charges once' })
  @ApiOkResponse({ type: PurchaseResultDto })
  purchase(
    @Param('episodeId', ID) episodeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.purchases.purchase(episodeId, user, idempotencyKey);
  }
}
