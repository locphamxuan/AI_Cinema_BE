import { Body, Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { Public } from 'src/common/decorators/public.decorator';
import { CoinTopUpService } from './coin-topup.service';
import { PaymentCallbackRequestDto } from './dto/payment-callback.request.dto';
import { providerOf } from 'src/modules/episode-access/coin-topup/utils/payment-provider.util';

/**
 * Step 12, the gateway side: webhooks settle top-up orders and the return trip forwards the
 * member back into the app. Webhooks are public (the gateway holds no token) and idempotent on
 * (provider, event_id): a repeated delivery answers with the same order and never credits twice.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentCallbackController {
  constructor(
    private readonly topUps: CoinTopUpService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('vnpay/callback')
  @ApiOperation({ summary: 'VNPay webhook; verifies the delivery and settles the order once' })
  @ApiBody({ type: PaymentCallbackRequestDto })
  vnpay(@Body() body: Record<string, unknown>) {
    return this.topUps.handleCallback(PaymentProvider.VNPAY, body ?? {});
  }

  @Public()
  @Post('momo/callback')
  @ApiOperation({ summary: 'MoMo webhook; verifies the delivery and settles the order once' })
  @ApiBody({ type: PaymentCallbackRequestDto })
  momo(@Body() body: Record<string, unknown>) {
    return this.topUps.handleCallback(PaymentProvider.MOMO, body ?? {});
  }

  @Public()
  @Get(':provider/return')
  @ApiOperation({ summary: 'Where the gateway sends the member back; forwards into the app' })
  @ApiQuery({ name: 'topUpId', required: false })
  @ApiQuery({ name: 'providerTxnId', required: false })
  async returnToApp(
    @Param('provider') providerParam: string,
    @Query('topUpId') topUpId: string | undefined,
    @Query('providerTxnId') providerTxnId: string | undefined,
    @Res() res: Response,
  ) {
    const provider = providerOf(providerParam);
    const order = await this.topUps.findForReturn(provider, { topUpId, providerTxnId });
    const url = `${this.config.webAppUrl}/wallet/top-ups/${order.topUpId}?status=${order.status}&provider=${provider}`;
    return res.redirect(url);
  }
}
