import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { BillingReportService } from './billing-report.service';
import { ChurnQueryDto } from 'src/modules/episode-access/billing-reports/dto/churn.query.dto';
import { RevenueQueryDto } from 'src/modules/episode-access/billing-reports/dto/revenue.query.dto';
import { reportRangeOf } from './report-range';

@ApiTags('admin-reports')
@ApiBearerAuth()
@Controller('admin/reports')
export class BillingReportController {
  constructor(private readonly reports: BillingReportService) {}

  @Get('revenue')
  @RequirePermission(PERMISSION.ANALYTICS_REVENUE_READ)
  @ApiOperation({ summary: 'Plan revenue per range, main Coins and bonus Coins apart' })
  async revenue(@Query() query: RevenueQueryDto) {
    const range = reportRangeOf(query.from, query.to);

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
    return this.reports.churn(reportRangeOf(query.from, query.to));
  }
}
