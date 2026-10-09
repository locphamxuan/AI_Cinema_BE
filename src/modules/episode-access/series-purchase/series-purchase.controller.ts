import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PurchaseResultDto } from '../episode-purchase/dto/purchase-result.dto';
import { SeriesPurchaseService } from './series-purchase.service';
import { IdempotencyKey } from 'src/common/decorators/idempotency-key.decorator';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('episode-access')
@ApiBearerAuth()
@Controller('movies')
export class SeriesPurchaseController {
  constructor(private readonly purchases: SeriesPurchaseService) {}

  @Post(':movieId/series-purchase')
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'Unlock every episode of a movie at once with Coin' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Sending it twice charges once' })
  @ApiOkResponse({ type: PurchaseResultDto })
  purchase(
    @Param('movieId', ID) movieId: string,
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.purchases.purchase(movieId, user, idempotencyKey);
  }
}
