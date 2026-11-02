import { BadGatewayException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { TOPUP_REASON } from '../constants/topup-reason';
import {
  buildVnpayPayUrl,
  formatVnpDateTime,
  parseVnpDateTime,
  signVnpayQuerydr,
  verifyVnpaySignature,
} from './vnpay-signing';

/** What a reconcile probe learned: settle it, fail it, or leave it for the next run. */
export interface ReconcileOutcome {
  outcome: 'PAID' | 'FAILED' | 'UNKNOWN';
  providerPaymentId?: string;
  amountVnd?: number;
  paidAt?: Date;
}

const GATEWAY_TIMEOUT_MS = 10_000;

/**
 * The only place that speaks the gateways' dialects. Coin code never builds a signed URL
 * or checks a checksum itself: it asks here for a payment link, a yes/no on a delivery,
 * and a second opinion on a silent attempt. VNPay is the only gateway.
 */
@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    const vnpay = this.config.payments.vnpay;
    return Boolean(vnpay.tmnCode && vnpay.hashSecret);
  }

  assertConfigured(provider: PaymentProvider): void {
    if (!this.isConfigured()) {
      throw new UnprocessableEntityException({
        message: `The ${provider} gateway is not configured`,
        details: { reason: TOPUP_REASON.PROVIDER_NOT_CONFIGURED, provider },
      });
    }
  }

  /** Where the member pays: a VNPay link signed locally, no network involved. */
  createPaymentUrl(input: {
    provider: PaymentProvider;
    providerTxnId: string;
    amountVnd: number;
    orderInfo?: string;
    clientIp?: string;
    expiresAt?: Date;
  }): string {
    this.assertConfigured(input.provider);
    return this.createVnpayPaymentUrl(input);
  }

  /**
   * Yes/no on a webhook delivery: a real HMAC check; anything unsigned is refused before
   * it can touch the ledger.
   */
  verifyCallbackSignature(_provider: PaymentProvider, raw: Record<string, unknown>): boolean {
    const { hashSecret } = this.config.payments.vnpay;
    if (!hashSecret) return false;
    return verifyVnpaySignature(raw, hashSecret);
  }

  /**
   * A second opinion on a silent attempt. Only a confirmed payment settles anything;
   * anything uncertain stays UNKNOWN so the sweep never fails an order on a guess.
   */
  async reconcilePayment(input: {
    provider: PaymentProvider;
    providerTxnId: string;
    referenceDate?: Date;
  }): Promise<ReconcileOutcome> {
    return this.queryVnpayTransaction(input.providerTxnId, input.referenceDate ?? new Date());
  }

  /**
   * A VNPay payment link, signed locally: no network involved. The order info stays
   * ASCII so the checksum survives the URL round-trip both ways.
   */
  private createVnpayPaymentUrl(input: {
    providerTxnId: string;
    amountVnd: number;
    clientIp?: string;
    expiresAt?: Date;
    orderInfo?: string;
  }): string {
    this.assertConfigured(PaymentProvider.VNPAY);
    const cfg = this.config.payments.vnpay;
    if (!cfg.returnUrl) {
      throw new UnprocessableEntityException({
        message: 'The VNPay gateway is missing its return URL',
        details: { reason: TOPUP_REASON.PROVIDER_NOT_CONFIGURED, provider: PaymentProvider.VNPAY },
      });
    }
    const now = new Date();
    const params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: cfg.tmnCode as string,
      vnp_Amount: String(input.amountVnd * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: input.providerTxnId,
      vnp_OrderInfo: input.orderInfo ?? `Nap-Coin-${input.providerTxnId}`,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: cfg.returnUrl,
      vnp_IpAddr: input.clientIp ?? '127.0.0.1',
      vnp_CreateDate: formatVnpDateTime(now),
      vnp_ExpireDate: formatVnpDateTime(input.expiresAt ?? new Date(now.getTime() + 15 * 60_000)),
    };
    if (cfg.ipnUrl) params.vnp_IpUrl = cfg.ipnUrl;
    return buildVnpayPayUrl(cfg.payUrl, params, cfg.hashSecret as string);
  }

  /**
   * Asks VNPay itself about a silent attempt (`querydr`). Only a double-confirmed
   * payment (`00`/`00`) settles anything; every other answer stays UNKNOWN.
   */
  private async queryVnpayTransaction(providerTxnId: string, referenceDate: Date): Promise<ReconcileOutcome> {
    this.assertConfigured(PaymentProvider.VNPAY);
    const cfg = this.config.payments.vnpay;
    const now = new Date();
    const requestId = `${providerTxnId}-${Date.now().toString(36)}`;
    const query = {
      vnp_RequestId: requestId,
      vnp_Version: '2.1.0',
      vnp_Command: 'querydr',
      vnp_TmnCode: cfg.tmnCode as string,
      vnp_TxnRef: providerTxnId,
      vnp_OrderInfo: `Query ${providerTxnId}`,
      vnp_TransactionDate: formatVnpDateTime(referenceDate),
      vnp_CreateDate: formatVnpDateTime(now),
      vnp_IpAddr: '127.0.0.1',
    };
    const body = {
      ...query,
      vnp_SecureHash: signVnpayQuerydr(
        {
          requestId,
          tmnCode: cfg.tmnCode as string,
          providerTxnId,
          transactionDate: referenceDate,
          createDate: now,
          ipAddr: '127.0.0.1',
          orderInfo: query.vnp_OrderInfo,
        },
        cfg.hashSecret as string,
      ),
    };
    let res: Response;
    try {
      res = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException({
        message: 'The VNPay gateway did not answer the status query',
        details: { reason: TOPUP_REASON.GATEWAY_UNREACHABLE, provider: PaymentProvider.VNPAY, cause: String(error) },
      });
    }
    if (!res.ok) {
      throw new BadGatewayException({
        message: `The VNPay gateway refused the status query (HTTP ${res.status})`,
        details: { reason: TOPUP_REASON.GATEWAY_UNREACHABLE, provider: PaymentProvider.VNPAY, httpStatus: res.status },
      });
    }
    const answer = (await res.json()) as {
      vnp_ResponseCode?: string;
      vnp_TransactionStatus?: string;
      vnp_TransactionNo?: string;
      vnp_Amount?: string;
      vnp_PayDate?: string;
      vnp_Message?: string;
    };
    if (answer.vnp_ResponseCode === '00' && answer.vnp_TransactionStatus === '00') {
      const amount = answer.vnp_Amount === undefined ? undefined : Math.floor(Number(answer.vnp_Amount) / 100);
      return {
        outcome: 'PAID',
        providerPaymentId: answer.vnp_TransactionNo,
        amountVnd: amount === undefined || !Number.isFinite(amount) ? undefined : amount,
        paidAt: parseVnpDateTime(answer.vnp_PayDate),
      };
    }
    return { outcome: 'UNKNOWN' };
  }
}
