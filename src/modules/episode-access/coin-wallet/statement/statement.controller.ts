import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CoinStatementQueryDto } from './dto/coin-statement-query.dto';
import { StatementService } from './statement.service';
import { toStatementFilter } from 'src/modules/episode-access/coin-wallet/statement/utils/statement.utils';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class StatementController {
  constructor(private readonly statements: StatementService) {}

  @Get('statements')
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'Coin transactions of the caller; kind = MAIN | BONUS | ALL' })
  mine(@CurrentUser('id') userId: string, @Paginate() query: PaginateQuery, @Query() filter: CoinStatementQueryDto) {
    return this.statements.history(toStatementFilter(userId, filter), query);
  }

  @Get('transactions/:id')
  @RequirePermission(PERMISSION.WALLET_READ)
  @ApiOperation({ summary: 'One Coin transaction with the balances right after it' })
  line(@CurrentUser('id') userId: string, @Param('id', ID) id: string) {
    return this.statements.line(userId, id);
  }
}
