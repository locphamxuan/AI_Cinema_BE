import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { BillingReportService } from './billing-report.service';
import { ChurnQueryDto } from 'src/modules/episode-access/billing-reports/dto/churn.query.dto';
import { RevenueQueryDto } from 'src/modules/episode-access/billing-reports/dto/revenue.query.dto';

/** Reports are asked for over a range; a missing bound falls back to the last 30 days. */
const DEFAULT_WINDOW_DAYS = 30;

@ApiTags('admin-reports')
@ApiBearerAuth()
@Controller('admin/reports')
export class BillingReportController {
  constructor(private readonly reports: BillingReportService) {}

  @Get('revenue')
  @RequirePermission(PERMISSION.ANALYTICS_REVENUE_READ)
  @ApiOperation({ summary: 'Plan revenue per range, main Coins and bonus Coins apart' })
  async revenue(@Query() query: RevenueQueryDto) {
    const range = rangeOf(query.from, query.to);

    const [totals, byDay] = await Promise.all([
      this.reports.revenue(range),
      query.byDay ? this.reports.revenueByDay(range) : Promise.resolve(undefined),
    ]);

    return { ...totals, byDay };
  }

  @Get('churn')
  @RequirePermission(PERMISSION.ANALYTICS_CHURN_READ)
  @ApiOperation({ summary: 'Cancellations, non-renewals and expiries per range' })
  churn(@Query() query: ChurnQueryDto) {
    return this.reports.churn(rangeOf(query.from, query.to));
  }
}

/** Both reports read the same range, so the bounds are resolved in one place. */
function rangeOf(from?: string, to?: string) {
  return {
    from: from ? new Date(from) : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000),
    to: to ? new Date(to) : new Date(),
  };
}
