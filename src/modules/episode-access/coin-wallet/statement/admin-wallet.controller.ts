import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { ParseUUIDPipe, Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AdminWalletService } from 'src/modules/episode-access/coin-wallet/statement/admin-wallet.service';
import { CoinStatementQueryDto } from 'src/modules/episode-access/coin-wallet/statement/dto/coin-statement-query.dto';
import { WalletAdjustmentRequestDto } from 'src/modules/episode-access/coin-wallet/statement/dto/wallet-adjustment.request.dto';

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
    summary: 'Coin ledger of the whole platform',
  })
  ledger(@Paginate() query: PaginateQuery, @Query() filter: CoinStatementQueryDto) {
    return this.adminWallets.ledger(filter, query);
  }

  @Post('wallet-adjustments')
  @RequirePermission(PERMISSION.COIN_ADJUST)
  @ApiOperation({
    summary: 'Correct a wallet by hand; writes an ADJUSTMENT row and an audit event',
  })
  adjust(@Body() dto: WalletAdjustmentRequestDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminWallets.adjust(dto, admin);
  }
}
