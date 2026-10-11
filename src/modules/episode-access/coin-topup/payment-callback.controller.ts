import { Body, Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { Public } from 'src/common/decorators/public.decorator';
import { CoinTopUpService } from './coin-topup.service';
import { PaymentGatewayService } from './gateways/payment-gateway.service';
import { PaymentCallbackRequestDto } from './dto/payment-callback.request.dto';
import { providerOf } from 'src/modules/episode-access/coin-topup/utils/payment-provider.util';

/**
 * Step 12, the gateway side: signed gateway callbacks and VNPay returns share the idempotent
 * settlement path; the return trip then forwards the member back into the app.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentCallbackController {
  constructor(
    private readonly topUps: CoinTopUpService,
    private readonly gateways: PaymentGatewayService,
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
    // VNPay returns here too (GET query, same URL family as its IPN): verify and process
    // through the idempotent settlement flow before forwarding the updated order status.
    if (provider === PaymentProvider.VNPAY) {
      const result = await this.vnpayReturn(query);
      if (!this.config.payments.vnpay.appReturnUrl) return res.redirect(result.url);
      return res
        .status(200)
        .type('html')
        .send(renderAppBridge(result.url, result.status));
    }
    const order = await this.topUps.findForReturn(provider, {
      topUpId: asText(query.topUpId),
      providerTxnId: asText(query.providerTxnId),
    });
    return res.redirect(this.orderUrl(order.topUpId, order.status, provider));
  }

  private async vnpayReturn(
    query: Record<string, string | string[] | undefined>,
  ): Promise<{ url: string; status: string }> {
    const failed = { url: this.vnpayOrderUrl(undefined, 'FAILED'), status: 'FAILED' };
    if (!this.gateways.verifyCallbackSignature(PaymentProvider.VNPAY, query)) return failed;
    const txnRef = asText(query.vnp_TxnRef);
    if (!txnRef) return failed;
    // A signed browser return can arrive before IPN; use the same idempotent settlement
    // path so polling can observe PAID without changing wallet/order rows in this controller.
    try {
      await this.topUps.handleVnpayIpn(query);
      const order = await this.topUps.findForReturn(PaymentProvider.VNPAY, { providerTxnId: txnRef });
      return { url: this.vnpayOrderUrl(order.topUpId, order.status), status: order.status };
    } catch {
      return failed;
    }
  }

  private vnpayOrderUrl(topUpId: string | undefined, status: string): string {
    const appReturnUrl = this.config.payments.vnpay.appReturnUrl;
    if (!appReturnUrl) {
      const query = `status=${encodeURIComponent(status)}&provider=${PaymentProvider.VNPAY}`;
      return topUpId
        ? `${this.config.webAppUrl}/wallet/top-ups/${encodeURIComponent(topUpId)}?${query}`
        : `${this.config.webAppUrl}/wallet/top-ups?${query}`;
    }

    const scheme = new URL(appReturnUrl).protocol;
    const destination = new URL(`${scheme}//wallet/top-ups`);
    if (topUpId) destination.searchParams.set('topUpId', topUpId);
    destination.searchParams.set('status', status);
    destination.searchParams.set('provider', PaymentProvider.VNPAY);
    return destination.toString();
  }

  private orderUrl(topUpId: string, status: string, provider: PaymentProvider): string {
    return `${this.config.webAppUrl}/wallet/top-ups/${topUpId}?status=${status}&provider=${provider}`;
  }
}

/** First string of a query value; VNPay never sends multi-valued keys our way. */
function asText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function renderAppBridge(deepLinkUrl: string, status: string): string {
  const safeDeepLink = JSON.stringify(deepLinkUrl)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const safeHref = escapeHtml(deepLinkUrl);
  const heading =
    status === 'PAID'
      ? 'Thanh toán thành công!'
      : status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED'
        ? 'Thanh toán chưa thành công'
        : 'Đang xác nhận thanh toán';
  const message =
    status === 'PENDING'
      ? 'Đơn hàng đang được xác nhận. Vui lòng quay lại ứng dụng để cập nhật trạng thái.'
      : 'Đang chuyển bạn trở lại ứng dụng AI Cinema...';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>AI Cinema - Hoàn tất thanh toán</title>
  <style>
    body { background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 80px 24px 24px; }
    .btn { display: inline-block; background: #10B981; color: #fff; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 16px; text-decoration: none; margin-top: 20px; }
  </style>
</head>
<body>
  <h2>${heading}</h2>
  <p>${message}</p>
  <a class="btn" href="${safeHref}">Mở lại ứng dụng ngay</a>
  <script>
    setTimeout(function() { window.location.href = ${safeDeepLink}; }, 500);
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}
