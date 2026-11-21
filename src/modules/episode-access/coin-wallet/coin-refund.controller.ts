import { Body, BadRequestException, Controller, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
  constructor(private readonly coins: CoinSpendService, private readonly prisma: PrismaService) {}

  @Post(':id/refund')
  @RequirePermission(PERMISSION.COIN_ADJUST)
  @ApiOperation({
    summary:
      'Refund a Coin transaction: main Coins go back to main, bonus Coins back to their lot, referencing the original entry',
  })
  @ApiOkResponse()
  async refund(@Param('id', ID) id: string, @CurrentUser('id') actorId: string) {
    const tx = await this.prisma.coinTransaction.findUnique({ where: { id } });
    if (!tx) {
      throw new NotFoundException({ message: 'Coin transaction not found', details: { reason: 'COIN_TRANSACTION_NOT_FOUND' } });
    }
    if (tx.entryType === 'REFUND') {
      throw new BadRequestException({ message: 'A refund cannot be refunded', details: { reason: 'CANNOT_REFUND_REFUND' } });
    }
    return this.coins.refund(this.prisma, tx.walletId, tx);
  }
}
