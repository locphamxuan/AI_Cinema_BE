import { PaymentProvider } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import { buildVnpayPayUrl } from './vnpay-signing';
import { PaymentGatewayService } from './payment-gateway.service';

const VNPAY = {
  tmnCode: 'TMN123',
  hashSecret: 'vnpay-hash-secret-for-tests',
  payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'https://api.example.com/api/payments/vnpay/return',
  ipnUrl: 'https://api.example.com/api/payments/vnpay/callback',
  apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
};

const configOf = (vnpay: Record<string, unknown> = {}) =>
  ({ payments: { vnpay: { ...VNPAY, ...vnpay } } }) as unknown as AppConfig;

const serviceWith = (vnpay: Record<string, unknown> = {}) => new PaymentGatewayService(configOf(vnpay));

describe('PaymentGatewayService configuration', () => {
  it('knows which providers can actually run', () => {
    expect(serviceWith().isConfigured()).toBe(true);
    expect(serviceWith({ tmnCode: undefined }).isConfigured()).toBe(false);
  });

  it('refuses to use a provider with no credentials', () => {
    const service = serviceWith({ hashSecret: undefined });

    let caught: unknown;
    try {
      service.createPaymentUrl({
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'M-1',
        amountVnd: 50000,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });
});

describe('PaymentGatewayService.createPaymentUrl', () => {
  afterEach(() => jest.restoreAllMocks());

  it('signs a VNPay payment URL without touching the network', () => {
    const service = serviceWith();
    const post = jest.spyOn(globalThis, 'fetch');

    const url = service.createPaymentUrl({
      provider: PaymentProvider.VNPAY,
      providerTxnId: 'VNPAY-A',
      amountVnd: 50000,
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

  it('refuses a VNPay order with no return URL configured', () => {
    const service = serviceWith({ returnUrl: undefined });

    let caught: unknown;
    try {
      service.createPaymentUrl({
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'VNPAY-A',
        amountVnd: 50000,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });
});

describe('PaymentGatewayService.verifyCallbackSignature', () => {
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
      serviceWith({ hashSecret: undefined }).verifyCallbackSignature(PaymentProvider.VNPAY, {
        vnp_SecureHash: 'x'.repeat(128),
      }),
    ).toBe(false);
  });
});

describe('PaymentGatewayService.reconcilePayment', () => {
  afterEach(() => jest.restoreAllMocks());

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
      serviceWith({ tmnCode: undefined }).reconcilePayment({
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'VNPAY-ABC',
      }),
    ).rejects.toMatchObject({ response: { details: { reason: 'PROVIDER_NOT_CONFIGURED' } } });
  });
});
