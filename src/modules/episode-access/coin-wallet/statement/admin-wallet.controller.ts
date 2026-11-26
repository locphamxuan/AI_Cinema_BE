import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { ParseUUIDPipe, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AdminWalletService } from 'src/modules/episode-access/coin-wallet/statement/admin-wallet.service';
import { CoinStatementQueryDto } from 'src/modules/episode-access/coin-wallet/statement/dto/coin-statement-query.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-coin')
@ApiBearerAuth()
@Controller('admin')
export class AdminWalletController {
  constructor(private readonly adminWallets: AdminWalletService) {}

  @Get('wallets/:userId')
  @RequirePermission(PERMISSION.COIN_WALLET_READ)
  @ApiOperation({
    summary: 'Wallet of a member with every bonus batch still usable',
  })
  wallet(@Param('userId', ID) userId: string) {
    return this.adminWallets.wallet(userId);
  }

  @Get('coin-transactions')
  @RequirePermission(PERMISSION.COIN_TRANSACTION_READ)
  @ApiOperation({
    summary: 'Coin ledger of the whole platform; every row names the member account it belongs to',
  })
  ledger(@Paginate() query: PaginateQuery, @Query() filter: CoinStatementQueryDto) {
    return this.adminWallets.ledger(filter, query);
  }
}
