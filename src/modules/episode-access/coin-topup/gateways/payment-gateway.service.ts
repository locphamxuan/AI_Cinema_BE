import { BadGatewayException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { TOPUP_REASON } from '../constants/topup-reason';
import {
  encodeTopUpExtraData,
  hmacSha256Hex,
  momoCreateRawSignature,
  momoStatusRawSignature,
  verifyMomoIpnSignature,
} from './momo-signing';
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
 * and a second opinion on a silent attempt. Both MoMo and VNPay are fully wired.
 */
@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(provider: PaymentProvider): boolean {
    if (provider === PaymentProvider.MOMO) {
      const momo = this.config.payments.momo;
      return Boolean(momo.partnerCode && momo.accessKey && momo.secretKey);
    }
    const vnpay = this.config.payments.vnpay;
    return Boolean(vnpay.tmnCode && vnpay.hashSecret);
  }

  assertConfigured(provider: PaymentProvider): void {
    if (!this.isConfigured(provider)) {
      throw new UnprocessableEntityException({
        message: `The ${provider} gateway is not configured`,
        details: { reason: TOPUP_REASON.PROVIDER_NOT_CONFIGURED, provider },
      });
    }
  }

  /**
   * Where the member pays. VNPay is a pure signed URL (no network); MoMo needs one
   * server-to-server call whose `payUrl` comes back.
   */
  async createPaymentUrl(input: {
    provider: PaymentProvider;
    providerTxnId: string;
    amountVnd: number;
    topUpId: string;
    orderInfo?: string;
    clientIp?: string;
    expiresAt?: Date;
  }): Promise<string> {
    if (input.provider === PaymentProvider.VNPAY) {
      return this.createVnpayPaymentUrl(input);
    }
    return this.createMomoPaymentUrl(input);
  }

  /**
   * Yes/no on a webhook delivery. Both gateways get a real HMAC check; anything
   * unsigned is refused before it can touch the ledger.
   */
  verifyCallbackSignature(provider: PaymentProvider, raw: Record<string, unknown>): boolean {
    if (provider === PaymentProvider.MOMO) {
      const { accessKey, secretKey } = this.config.payments.momo;
      if (!accessKey || !secretKey) return false;
      return verifyMomoIpnSignature(raw, accessKey, secretKey);
    }
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
    if (input.provider === PaymentProvider.VNPAY) {
      return this.queryVnpayTransaction(input.providerTxnId, input.referenceDate ?? new Date());
    }
    if (input.provider !== PaymentProvider.MOMO || !this.isConfigured(PaymentProvider.MOMO)) {
      return { outcome: 'UNKNOWN' };
    }
    const { partnerCode, accessKey, secretKey, statusUrl } = this.config.payments.momo;
    const body = {
      partnerCode: partnerCode as string,
      requestId: input.providerTxnId,
      orderId: input.providerTxnId,
      signature: hmacSha256Hex(
        secretKey as string,
        momoStatusRawSignature({
          accessKey: accessKey as string,
          partnerCode: partnerCode as string,
          orderId: input.providerTxnId,
          requestId: input.providerTxnId,
        }),
      ),
      lang: 'vi',
    };
    let res: Response;
    try {
      res = await fetch(statusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException({
        message: 'The MoMo gateway did not answer the status query',
        details: { reason: TOPUP_REASON.GATEWAY_UNREACHABLE, provider: input.provider, cause: String(error) },
      });
    }
    if (!res.ok) {
      throw new BadGatewayException({
        message: `The MoMo gateway refused the status query (HTTP ${res.status})`,
        details: { reason: TOPUP_REASON.GATEWAY_UNREACHABLE, provider: input.provider, httpStatus: res.status },
      });
    }
    const answer = (await res.json()) as {
      resultCode?: number;
      transId?: number | string;
      amount?: number | string;
      responseTime?: number | string;
      message?: string;
    };
    if (answer.resultCode === 0) {
      const paidAt = Number(answer.responseTime);
      return {
        outcome: 'PAID',
        providerPaymentId: answer.transId === undefined ? undefined : String(answer.transId),
        amountVnd: answer.amount === undefined ? undefined : Number(answer.amount),
        paidAt: Number.isFinite(paidAt) ? new Date(paidAt) : undefined,
      };
    }
    return { outcome: 'UNKNOWN' };
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

  private async createMomoPaymentUrl(input: {
    providerTxnId: string;
    amountVnd: number;
    topUpId: string;
    orderInfo?: string;
  }): Promise<string> {
    this.assertConfigured(PaymentProvider.MOMO);
    const cfg = this.config.payments.momo;
    if (!cfg.redirectUrl || !cfg.ipnUrl) {
      throw new UnprocessableEntityException({
        message: 'The MoMo gateway is missing its redirect or IPN URL',
        details: { reason: TOPUP_REASON.PROVIDER_NOT_CONFIGURED, provider: PaymentProvider.MOMO },
      });
    }
    const payload = {
      partnerCode: cfg.partnerCode as string,
      accessKey: cfg.accessKey as string,
      orderId: input.providerTxnId,
      requestId: input.providerTxnId,
      amount: String(input.amountVnd),
      orderInfo: input.orderInfo ?? `Nap ${input.amountVnd} VND mua Coin`,
      redirectUrl: cfg.redirectUrl,
      ipnUrl: cfg.ipnUrl,
      lang: 'vi',
      requestType: cfg.requestType,
      autoCapture: true,
      extraData: encodeTopUpExtraData(input.topUpId),
      signature: '',
    };
    payload.signature = hmacSha256Hex(
      cfg.secretKey as string,
      momoCreateRawSignature({
        accessKey: cfg.accessKey as string,
        partnerCode: payload.partnerCode,
        orderId: payload.orderId,
        requestId: payload.requestId,
        amountVnd: input.amountVnd,
        orderInfo: payload.orderInfo,
        redirectUrl: payload.redirectUrl,
        ipnUrl: payload.ipnUrl,
        extraData: payload.extraData,
        requestType: payload.requestType,
      }),
    );
    let res: Response;
    try {
      res = await fetch(cfg.createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException({
        message: 'The MoMo gateway did not answer the create-order call',
        details: { reason: TOPUP_REASON.GATEWAY_UNREACHABLE, provider: PaymentProvider.MOMO, cause: String(error) },
      });
    }
    if (!res.ok) {
      throw new BadGatewayException({
        message: `The MoMo gateway refused the create-order call (HTTP ${res.status})`,
        details: { reason: TOPUP_REASON.GATEWAY_UNREACHABLE, provider: PaymentProvider.MOMO, httpStatus: res.status },
      });
    }
    const answer = (await res.json()) as { resultCode?: number; payUrl?: string; message?: string };
    if (answer.resultCode !== 0 || !answer.payUrl) {
      throw new BadGatewayException({
        message: `MoMo refused the order: ${answer.message ?? 'unknown reason'}`,
        details: {
          reason: TOPUP_REASON.GATEWAY_UNREACHABLE,
          provider: PaymentProvider.MOMO,
          resultCode: answer.resultCode,
        },
      });
    }
    return answer.payUrl;
  }
}
