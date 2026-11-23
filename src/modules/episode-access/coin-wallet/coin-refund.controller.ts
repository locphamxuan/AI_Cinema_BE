import { Controller, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CoinSpendService } from './coin-spend.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-coin-refund')
@ApiBearerAuth()
@Controller('admin/coin-transactions')
export class CoinRefundController {
  constructor(
    private readonly coins: CoinSpendService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':id/refund')
  @RequirePermission(PERMISSION.COIN_ADJUST)
  @ApiOperation({
    summary:
      'Refund one Coin payment row once: main Coins go back to main, bonus Coins back as a refund lot, referencing the original entry',
  })
  @ApiOkResponse()
  refund(@Param('id', ID) id: string, @CurrentUser('id') actorId: string) {
    // One transaction: the wallet lock, the already-refunded check and the credit commit together.
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.coinTransaction.findUnique({ where: { id } });
      if (!original) {
        throw new NotFoundException({
          message: 'Coin transaction not found',
          details: { reason: 'COIN_TRANSACTION_NOT_FOUND' },
        });
      }
      return this.coins.refund(tx, original.walletId, original, actorId);
    });
  }
}
