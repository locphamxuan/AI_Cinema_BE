import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CoinRefundService } from './coin-refund.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-coin-refund')
@ApiBearerAuth()
@Controller('admin/coin-transactions')
export class CoinRefundController {
  constructor(private readonly refunds: CoinRefundService) {}

  @Post(':id/refund')
  @RequirePermission(PERMISSION.COIN_REFUND)
  @ApiOperation({
    summary:
      'Refund the whole Coin payment this row belongs to, once: main Coins back to main, bonus Coins back as a ' +
      'refund lot; the episode unlock is revoked, or the plan cycle is marked REFUNDED (a running plan ends)',
  })
  @ApiOkResponse()
  refund(@Param('id', ID) id: string, @CurrentUser('id') actorId: string) {
    return this.refunds.refundByAdmin(id, actorId);
  }
}
