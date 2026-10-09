import { PaymentProvider } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import {
  decodeTopUpExtraData,
  encodeTopUpExtraData,
  hmacSha256Hex,
  secureCompare,
  signMomoCreateRequest,
  verifyMomoIpnSignature,
} from './momo-signing';
import { buildVnpayPayUrl } from './vnpay-signing';
import { PaymentGatewayService } from './payment-gateway.service';

const MOMO = {
  partnerCode: 'MOMO',
  accessKey: 'F8Btg8Lh6ak87iut',
  secretKey: 's3cr3t-key-for-tests',
  createUrl: 'https://test-payment.momo.vn/v2/gateway/api/create',
  statusUrl: 'https://test-payment.momo.vn/v2/gateway/api/transaction-status',
  redirectUrl: 'https://api.example.com/api/payments/momo/return',
  ipnUrl: 'https://api.example.com/api/payments/momo/callback',
  requestType: 'payWithMethod',
};
const VNPAY = {
  tmnCode: 'TMN123',
  hashSecret: 'vnpay-hash-secret-for-tests',
  payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'https://api.example.com/api/payments/vnpay/return',
  ipnUrl: 'https://api.example.com/api/payments/vnpay/callback',
  apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
};

const configOf = (momo: Record<string, unknown> = {}, vnpay: Record<string, unknown> = {}) =>
  ({ payments: { momo: { ...MOMO, ...momo }, vnpay: { ...VNPAY, ...vnpay } } }) as unknown as AppConfig;

const serviceWith = (momo: Record<string, unknown> = {}, vnpay: Record<string, unknown> = {}) =>
  new PaymentGatewayService(configOf(momo, vnpay));

function signedIpn(overrides: Record<string, unknown> = {}) {
  const body = {
    partnerCode: 'MOMO',
    orderId: 'MOMO-ABC',
    requestId: 'MOMO-ABC',
    amount: 50000,
    orderInfo: 'Nap 50000 VND mua Coin',
    orderType: 'momo_wallet',
    transId: 123456789,
    resultCode: 0,
    message: 'Successful.',
    payType: 'qr',
    responseTime: 1700000000000,
    extraData: encodeTopUpExtraData('topup-1'),
    ...overrides,
  };
  return {
    ...body,
    signature: hmacSha256Hex(
      MOMO.secretKey,
      [
        `accessKey=${MOMO.accessKey}`,
        `amount=${body.amount}`,
        `extraData=${body.extraData}`,
        `message=${body.message}`,
        `orderId=${body.orderId}`,
        `orderInfo=${body.orderInfo}`,
        `orderType=${body.orderType}`,
        `partnerCode=${body.partnerCode}`,
        `payType=${body.payType}`,
        `requestId=${body.requestId}`,
        `responseTime=${body.responseTime}`,
        `resultCode=${body.resultCode}`,
        `transId=${body.transId}`,
      ].join('&'),
    ),
  };
}

describe('momo-signing', () => {
  it('round-trips signatures and rejects tampered bodies', () => {
    const body = signedIpn();
    expect(verifyMomoIpnSignature(body, MOMO.accessKey, MOMO.secretKey)).toBe(true);
    expect(verifyMomoIpnSignature({ ...body, amount: 40000 }, MOMO.accessKey, MOMO.secretKey)).toBe(false);
    expect(verifyMomoIpnSignature({ ...body, signature: '0'.repeat(64) }, MOMO.accessKey, MOMO.secretKey)).toBe(false);
  });

  it('rejects short or missing signatures without throwing', () => {
    const body = signedIpn();
    expect(verifyMomoIpnSignature({ ...body, signature: 'abc' }, MOMO.accessKey, MOMO.secretKey)).toBe(false);
    expect(verifyMomoIpnSignature({ ...body, signature: undefined }, MOMO.accessKey, MOMO.secretKey)).toBe(false);
    expect(secureCompare('a'.repeat(64), undefined)).toBe(false);
  });

  it('builds a 64-hex create signature that depends on every field', () => {
    const params = {
      accessKey: MOMO.accessKey,
      partnerCode: MOMO.partnerCode,
      orderId: 'MOMO-ABC',
      requestId: 'MOMO-ABC',
      amountVnd: 50000,
      orderInfo: 'Nap 50000 VND mua Coin',
      redirectUrl: MOMO.redirectUrl,
      ipnUrl: MOMO.ipnUrl,
      extraData: encodeTopUpExtraData('topup-1'),
      requestType: MOMO.requestType,
    };
    const signature = signMomoCreateRequest(params, MOMO.secretKey);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signMomoCreateRequest({ ...params, amountVnd: 40000 }, MOMO.secretKey)).not.toBe(signature);
    expect(signMomoCreateRequest(params, 'other-secret')).not.toBe(signature);
  });

  it('carries the order id through extraData and back', () => {
    expect(decodeTopUpExtraData(encodeTopUpExtraData('topup-1'))).toBe('topup-1');
    expect(decodeTopUpExtraData(undefined)).toBeUndefined();
    expect(decodeTopUpExtraData('not-base64!!!')).toBeUndefined();
    expect(decodeTopUpExtraData(Buffer.from(JSON.stringify({ nope: 1 })).toString('base64'))).toBeUndefined();
  });
});

describe('PaymentGatewayService configuration', () => {
  it('knows which providers can actually run', () => {
    expect(serviceWith().isConfigured(PaymentProvider.MOMO)).toBe(true);
    expect(serviceWith().isConfigured(PaymentProvider.VNPAY)).toBe(true);
    expect(serviceWith({}, { tmnCode: undefined }).isConfigured(PaymentProvider.VNPAY)).toBe(false);
    expect(serviceWith({ secretKey: undefined }).isConfigured(PaymentProvider.MOMO)).toBe(false);
  });

  it('refuses to use a provider with no credentials', async () => {
    const service = serviceWith({ secretKey: undefined });

    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.MOMO,
        providerTxnId: 'M-1',
        amountVnd: 50000,
        topUpId: 't-1',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });
});

describe('PaymentGatewayService.createPaymentUrl', () => {
  afterEach(() => jest.restoreAllMocks());

  it('signs a VNPay payment URL without touching the network', async () => {
    const service = serviceWith();
    const post = jest.spyOn(globalThis, 'fetch');

    const url = await service.createPaymentUrl({
      provider: PaymentProvider.VNPAY,
      providerTxnId: 'VNPAY-A',
      amountVnd: 50000,
      topUpId: 't-1',
      clientIp: '203.0.113.7',
    });

    expect(post).not.toHaveBeenCalled();
    expect(url).toContain('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?');
    expect(url).toContain('vnp_TmnCode=TMN123');
    expect(url).toContain('vnp_Amount=5000000');
    expect(url).toContain('vnp_TxnRef=VNPAY-A');
    expect(url).toContain('vnp_IpAddr=203.0.113.7');
    expect(url).toMatch(/vnp_SecureHash=[0-9a-f]{128}$/);
  });

  it('refuses a VNPay order with no return URL configured', async () => {
    const service = serviceWith({}, { returnUrl: undefined });

    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'VNPAY-A',
        amountVnd: 50000,
        topUpId: 't-1',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });

  it('asks MoMo for a payUrl and returns it', async () => {
    const payUrl = 'https://test-payment.momo.vn/pay/abc';
    const post = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ resultCode: 0, payUrl, message: 'Successful.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const service = serviceWith();

    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.MOMO,
        providerTxnId: 'MOMO-ABC',
        amountVnd: 50000,
        topUpId: 'topup-1',
      }),
    ).resolves.toBe(payUrl);

    expect(post).toHaveBeenCalledWith(
      MOMO.createUrl,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"orderId":"MOMO-ABC"'),
      }),
    );
    const sent = JSON.parse(post.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(sent.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.amount).toBe('50000');
    expect(sent.extraData).toBe(encodeTopUpExtraData('topup-1'));
  });

  it('fails loudly when MoMo refuses or stays silent', async () => {
    const service = serviceWith();

    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ resultCode: 1006, message: 'Rejected.' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.MOMO,
        providerTxnId: 'M-1',
        amountVnd: 50000,
        topUpId: 't-1',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'GATEWAY_UNREACHABLE' } } });
    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.MOMO,
        providerTxnId: 'M-1',
        amountVnd: 50000,
        topUpId: 't-1',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'GATEWAY_UNREACHABLE' } } });
    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.MOMO,
        providerTxnId: 'M-1',
        amountVnd: 50000,
        topUpId: 't-1',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'GATEWAY_UNREACHABLE' } } });
  });

  it('needs the redirect and IPN urls before calling MoMo', async () => {
    const service = serviceWith({ redirectUrl: undefined });

    await expect(
      service.createPaymentUrl({
        provider: PaymentProvider.MOMO,
        providerTxnId: 'M-1',
        amountVnd: 50000,
        topUpId: 't-1',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });
});

describe('PaymentGatewayService.verifyCallbackSignature', () => {
  it('accepts a well-signed MoMo IPN and rejects tampering', () => {
    const service = serviceWith();
    expect(service.verifyCallbackSignature(PaymentProvider.MOMO, signedIpn())).toBe(true);
    expect(service.verifyCallbackSignature(PaymentProvider.MOMO, { ...signedIpn(), resultCode: 1006 })).toBe(false);
  });

  it('fails closed when MoMo has no secret to check against', () => {
    expect(serviceWith({ secretKey: undefined }).verifyCallbackSignature(PaymentProvider.MOMO, signedIpn())).toBe(
      false,
    );
  });

  it('checks a VNPay query checksum for real', () => {
    const params = {
      vnp_TmnCode: 'TMN123',
      vnp_Amount: '5000000',
      vnp_TxnRef: 'VNPAY-ABC',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
    };
    const url = buildVnpayPayUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', params, VNPAY.hashSecret);
    const query = Object.fromEntries(new URL(url).searchParams.entries());
    const service = serviceWith();

    expect(service.verifyCallbackSignature(PaymentProvider.VNPAY, query)).toBe(true);
    expect(service.verifyCallbackSignature(PaymentProvider.VNPAY, { ...query, vnp_Amount: '4000000' })).toBe(false);
    expect(service.verifyCallbackSignature(PaymentProvider.VNPAY, { vnp_SecureHash: 'x' })).toBe(false);
  });

  it('fails closed when VNPay has no secret to check against', () => {
    expect(
      serviceWith({}, { hashSecret: undefined }).verifyCallbackSignature(PaymentProvider.VNPAY, {
        vnp_SecureHash: 'x'.repeat(128),
      }),
    ).toBe(false);
  });
});

describe('PaymentGatewayService.reconcilePayment', () => {
  afterEach(() => jest.restoreAllMocks());

  it('leaves unconfigured gateways alone without touching the network', async () => {
    const post = jest.spyOn(globalThis, 'fetch');
    await expect(
      serviceWith({ secretKey: undefined }).reconcilePayment({ provider: PaymentProvider.MOMO, providerTxnId: 'M-1' }),
    ).resolves.toEqual({ outcome: 'UNKNOWN' });
    expect(post).not.toHaveBeenCalled();
  });

  it('asks VNPay itself about a silent attempt (querydr)', async () => {
    const post = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          vnp_ResponseCode: '00',
          vnp_TransactionStatus: '00',
          vnp_TransactionNo: '987654321',
          vnp_Amount: '5000000',
          vnp_PayDate: '20260101070000',
        }),
        { status: 200 },
      ),
    );
    const service = serviceWith();

    await expect(
      service.reconcilePayment({
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'VNPAY-ABC',
        referenceDate: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      outcome: 'PAID',
      providerPaymentId: '987654321',
      amountVnd: 50000,
      paidAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(post).toHaveBeenCalledWith(
      VNPAY.apiUrl,
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"vnp_Command":"querydr"') }),
    );
    const sent = JSON.parse(post.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(sent.vnp_TxnRef).toBe('VNPAY-ABC');
    expect(sent.vnp_SecureHash).toMatch(/^[0-9a-f]{128}$/);
  });

  it('stays quiet when VNPay does not confirm the payment', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ vnp_ResponseCode: '00', vnp_TransactionStatus: '24' }), { status: 200 }),
      );

    await expect(
      serviceWith().reconcilePayment({ provider: PaymentProvider.VNPAY, providerTxnId: 'VNPAY-ABC' }),
    ).resolves.toEqual({ outcome: 'UNKNOWN' });
  });

  it('throws when VNPay cannot be reached, so the sweep retries later', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    await expect(
      serviceWith().reconcilePayment({ provider: PaymentProvider.VNPAY, providerTxnId: 'VNPAY-ABC' }),
    ).rejects.toMatchObject({ response: { details: { reason: 'GATEWAY_UNREACHABLE' } } });
  });

  it('refuses to probe VNPay with no credentials', async () => {
    await expect(
      serviceWith({}, { tmnCode: undefined }).reconcilePayment({
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'VNPAY-ABC',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });

  it('reports a paid MoMo order with its gateway receipt', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ resultCode: 0, transId: 123456789, amount: 50000, responseTime: 1700000000000 }),
          { status: 200 },
        ),
      );

    await expect(
      serviceWith().reconcilePayment({ provider: PaymentProvider.MOMO, providerTxnId: 'MOMO-ABC' }),
    ).resolves.toEqual({
      outcome: 'PAID',
      providerPaymentId: '123456789',
      amountVnd: 50000,
      paidAt: new Date(1700000000000),
    });
  });

  it('stays quiet on anything but a confirmed payment', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ resultCode: 1006, message: 'Nope.' }), { status: 200 }));

    await expect(
      serviceWith().reconcilePayment({ provider: PaymentProvider.MOMO, providerTxnId: 'MOMO-ABC' }),
    ).resolves.toEqual({ outcome: 'UNKNOWN' });
  });

  it('throws when MoMo cannot be reached, so the sweep retries later', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    await expect(
      serviceWith().reconcilePayment({ provider: PaymentProvider.MOMO, providerTxnId: 'MOMO-ABC' }),
    ).rejects.toMatchObject({ response: { details: { reason: 'GATEWAY_UNREACHABLE' } } });
  });
});
