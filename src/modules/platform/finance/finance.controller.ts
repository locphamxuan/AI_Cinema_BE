import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ReviewTransactionFlagRequestDto } from './dto/finance.request.dto';
import { FilmFinanceService } from './film-finance.service';
import { RiskFlagService } from './risk-flag.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-5 Financial Dashboard and Analytics / Risk / Oversight — every route is the Admin's only. */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class FinanceController {
  constructor(
    private readonly films: FilmFinanceService,
    private readonly risk: RiskFlagService,
  ) {}

  @Get('films')
  @RequirePermission(PERMISSION.FINANCE_REPORT_READ)
  @ApiOperation({ summary: 'Per movie: cost, episode sales less refunds, Monthly-plan share, profit' })
  filmFinance() {
    return this.films.films();
  }

  @Get('risk/rules')
  @RequirePermission(PERMISSION.RISK_FLAG_MANAGE)
  @ApiOperation({ summary: 'The rules that flag risky Coin transactions' })
  riskRules() {
    return this.risk.rules();
  }

  @Get('risk/flags')
  @RequirePermission(PERMISSION.RISK_FLAG_MANAGE)
  @ApiOperation({ summary: 'Flagged Coin transactions; e.g. filter.status=$eq:OPEN' })
  flags(@Paginate() query: PaginateQuery) {
    return this.risk.list(query);
  }

  @Post('risk/scan')
  @HttpCode(200)
  @RequirePermission(PERMISSION.RISK_FLAG_MANAGE)
  @ApiOperation({ summary: 'Run the risk rules now over the last 7 days; answers the new flags per rule' })
  scan() {
    return this.risk.scan();
  }

  @Post('risk/flags/:flagId/review')
  @HttpCode(200)
  @RequirePermission(PERMISSION.RISK_FLAG_MANAGE)
  @ApiOperation({
    summary: 'Lock the member account of a flag (signs it out everywhere; note required) or dismiss the flag',
    description: '409 when the flag is no longer open, or RISK_FLAG_NOT_A_MEMBER when the account is not a member',
  })
  review(
    @Param('flagId', ID) flagId: string,
    @Body() dto: ReviewTransactionFlagRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.risk.review(flagId, dto.decision, dto.note, user);
  }
}
