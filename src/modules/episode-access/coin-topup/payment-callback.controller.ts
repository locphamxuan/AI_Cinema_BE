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
  @ApiOperation({ summary: 'VNPay webhook (JSON shape); verifies the delivery and settles the order once' })
  @ApiBody({ type: PaymentCallbackRequestDto })
  vnpay(@Body() body: Record<string, unknown>) {
    return this.topUps.handleCallback(PaymentProvider.VNPAY, body ?? {});
  }

  /**
   * VNPay only speaks GET query strings, for both its server-to-server IPN and the
   * member's return trip. The IPN answers in VNPay's own `{RspCode, Message}` codes so
   * the gateway stops retrying once processed.
   */
  @Public()
  @Get('vnpay/callback')
  @ApiOperation({ summary: 'VNPay IPN (GET query); answers {RspCode, Message} per VNPay spec' })
  vnpayIpn(@Query() query: Record<string, string | string[] | undefined>) {
    return this.topUps.handleVnpayIpn(query);
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
    @Query() query: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ) {
    const provider = providerOf(providerParam);
    // VNPay returns here too (GET query, same URL family as its IPN): verify first,
    // then forward. Nothing settles on this trip on purpose — the IPN (or the
    // reconcile sweep) owns the ledger, and the app polls the order meanwhile.
    if (provider === PaymentProvider.VNPAY) {
      return res.redirect(await this.vnpayReturnUrl(query));
    }
    const order = await this.topUps.findForReturn(provider, {
      topUpId: asText(query.topUpId),
      providerTxnId: asText(query.providerTxnId),
    });
    return res.redirect(this.orderUrl(order.topUpId, order.status, provider));
  }

  private async vnpayReturnUrl(query: Record<string, string | string[] | undefined>): Promise<string> {
    const failed = `${this.config.webAppUrl}/wallet/top-ups?status=FAILED&provider=${PaymentProvider.VNPAY}`;
    const txnRef = asText(query.vnp_TxnRef);
    if (!txnRef) return failed;
    // Settle stays with the IPN and the sweep, never the browser trip: this only forwards.
    try {
      const order = await this.topUps.findForReturn(PaymentProvider.VNPAY, { providerTxnId: txnRef });
      return this.orderUrl(order.topUpId, order.status, PaymentProvider.VNPAY);
    } catch {
      return failed;
    }
  }

  private orderUrl(topUpId: string, status: string, provider: PaymentProvider): string {
    return `${this.config.webAppUrl}/wallet/top-ups/${topUpId}?status=${status}&provider=${provider}`;
  }
}

/** First string of a query value; VNPay never sends multi-valued keys our way. */
function asText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
