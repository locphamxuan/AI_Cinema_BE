import { Controller, Get, Ip, Param, ParseUUIDPipe, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CoinTopUpService } from './coin-topup.service';
import { CreateCoinTopUpRequestDto } from './dto/create-coin-top-up.request.dto';
import { CoinTopUpView, TopUpOptionsView } from 'src/modules/episode-access/coin-topup/dto/coin-topup.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('coin-wallet')
@ApiBearerAuth()
@Controller('wallet/top-ups')
export class CoinTopUpController {
  constructor(private readonly topUps: CoinTopUpService) {}

  @Post()
  @RequirePermission(PERMISSION.WALLET_TOPUP)
  @ApiOperation({ summary: 'Start a Coin top-up; returns the order and where to pay' })
  @ApiOkResponse({ type: CoinTopUpView })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateCoinTopUpRequestDto, @Ip() ip: string) {
    return this.topUps.create(userId, dto.provider, dto.amountVnd, ip);
  }

  @Get()
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'My top-up orders' })
  listMine(@CurrentUser('id') userId: string, @Paginate() query: PaginateQuery) {
    return this.topUps.listMine(userId, query);
  }

  // Declared before ':topUpId' so the literal path is not read as an id.
  @Get('options')
  @RequirePermission(PERMISSION.WALLET_TOPUP)
  @ApiOperation({ summary: 'Coin rate and accepted VND range, to quote Coins before paying' })
  @ApiOkResponse({ type: TopUpOptionsView })
  options() {
    return this.topUps.options();
  }

  @Get(':topUpId')
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'State of one of my top-up orders' })
  @ApiOkResponse({ type: CoinTopUpView })
  findMine(@CurrentUser('id') userId: string, @Param('topUpId', ID) topUpId: string) {
    return this.topUps.findMine(userId, topUpId);
  }
}
