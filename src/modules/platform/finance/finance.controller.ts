import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PeriodQueryDto, ReviewTransactionFlagRequestDto } from './dto/finance.request.dto';
import { FilmFinanceService } from './film-finance.service';
import { previousPeriod } from './finance-period';
import { RevenueAllocationService } from './revenue-allocation.service';
import { RiskFlagService } from './risk-flag.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-5 Financial Dashboard and Analytics / Risk / Oversight — every route is the Admin's only. */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class FinanceController {
  constructor(
    private readonly films: FilmFinanceService,
    private readonly allocations: RevenueAllocationService,
    private readonly risk: RiskFlagService,
  ) {}

  @Get('films')
  @RequirePermission(PERMISSION.FINANCE_REPORT_READ)
  @ApiOperation({ summary: 'Per movie: production cost, unlock revenue less refunds, Monthly-plan share, profit, ROI' })
  filmFinance() {
    return this.films.films();
  }

  @Get('revenue-allocations')
  @RequirePermission(PERMISSION.FINANCE_REPORT_READ)
  @ApiOperation({ summary: 'BR-48: how a month of Monthly-plan revenue was shared across movies by watch time' })
  allocation(@Query() query: PeriodQueryDto) {
    return this.allocations.list(query.period ?? previousPeriod(new Date()));
  }

  @Post('revenue-allocations/:period/run')
  @HttpCode(200)
  @RequirePermission(PERMISSION.FINANCE_ALLOCATION_RUN)
  @ApiOperation({ summary: 'Share a finished month again (replaces its rows, never doubles them)' })
  runAllocation(@Param('period') period: string, @CurrentUser() user: AuthenticatedUser) {
    return this.allocations.allocate(period, user.id);
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
  @ApiOperation({ summary: 'Run the risk rules now over the last 7 days' })
  scan() {
    return this.risk.scan();
  }

  @Post('risk/flags/:flagId/review')
  @HttpCode(200)
  @RequirePermission(PERMISSION.RISK_FLAG_MANAGE)
  @ApiOperation({ summary: 'Confirm or dismiss a flag, with a note' })
  review(
    @Param('flagId', ID) flagId: string,
    @Body() dto: ReviewTransactionFlagRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.risk.review(flagId, dto.decision, dto.note, user);
  }
}
