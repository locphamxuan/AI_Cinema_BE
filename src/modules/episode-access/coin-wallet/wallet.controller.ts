import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { WalletService } from './wallet.service';
import { AffordabilityQueryDto } from 'src/modules/episode-access/coin-wallet/dto/affordability.query.dto';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'Coin balance of the caller: main and bonus apart, plus what expires soon' })
  @ApiOkResponse({
    schema: {
      example: {
        mainBalance: 120,
        bonusBalance: 40,
        version: 7,
        expiringBonus: [{ lotId: '6b1e...', amount: 40, expiresAt: '2026-11-04T03:10:00.000Z' }],
      },
    },
  })
  mine(@CurrentUser('id') userId: string) {
    return this.wallets.view(userId);
  }

  @Get('affordability')
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({
    summary: 'What a price costs the wallet: main Coins first, then bonus Coins',
  })
  @ApiOkResponse({
    schema: {
      example: {
        requiredCoins: 25,
        mainBalance: 10,
        bonusBalance: 40,
        enoughCoins: true,
        missingCoins: 0,
        plannedSplit: { mainCoins: 10, bonusCoins: 15 },
      },
    },
  })
  affordability(@CurrentUser('id') userId: string, @Query() query: AffordabilityQueryDto) {
    return this.wallets.affordability(userId, query.amountCoins);
  }
}
