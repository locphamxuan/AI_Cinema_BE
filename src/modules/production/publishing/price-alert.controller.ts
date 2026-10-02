import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { RequestPriceChangeRequestDto } from './dto/publishing.request.dto';
import { PricingService } from './pricing.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('price-alerts')
@ApiBearerAuth()
@Controller('admin/price-alerts')
export class PriceAlertController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @RequirePermission(PERMISSION.PRICE_ALERT_MANAGE)
  @ApiOperation({ summary: 'Coin prices outside the platform range (BR-47); e.g. filter.status=$eq:OPEN' })
  list(@Paginate() query: PaginateQuery) {
    return this.pricing.listAlerts(query);
  }

  @Post(':alertId/request-change')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRICE_ALERT_MANAGE)
  @ApiOperation({ summary: 'Ask the Reviewer to change the price; the Admin never edits it' })
  requestChange(
    @Param('alertId', ID) alertId: string,
    @Body() dto: RequestPriceChangeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pricing.requestChange(alertId, dto.note, user);
  }

  @Post(':alertId/resolve')
  @HttpCode(200)
  @RequirePermission(PERMISSION.PRICE_ALERT_MANAGE)
  @ApiOperation({ summary: 'Accept the out-of-range price as it is' })
  resolve(@Param('alertId', ID) alertId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.resolve(alertId, user);
  }
}
