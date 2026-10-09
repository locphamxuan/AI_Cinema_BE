import {
  buildVnpayPayUrl,
  formatVnpDateTime,
  parseVnpDateTime,
  signVnpayParams,
  signVnpayQuerydr,
  verifyVnpaySignature,
  vnpayQuerydrRawSignature,
  VNPAY_RSP,
} from './vnpay-signing';

const SECRET = 'test-hash-secret';

const PAY_PARAMS = {
  vnp_Version: '2.1.0',
  vnp_Command: 'pay',
  vnp_TmnCode: 'TMN123',
  vnp_Amount: '5000000',
  vnp_CurrCode: 'VND',
  vnp_TxnRef: 'VNPAY-ABC',
  vnp_OrderInfo: 'Nap-Coin-VNPAY-ABC',
  vnp_ReturnUrl: 'https://api.example.com/api/payments/vnpay/return',
  vnp_IpAddr: '127.0.0.1',
  vnp_CreateDate: '20260101070000',
};

describe('vnpay date time', () => {
  it('formats Vietnam time as yyyyMMddHHmmss', () => {
    expect(formatVnpDateTime(new Date('2026-01-01T00:00:00.000Z'))).toBe('20260101070000');
    expect(formatVnpDateTime(new Date('2026-06-15T16:59:59.000Z'))).toBe('20260615235959');
  });

  it('parses the same stamps back and refuses garbage', () => {
    expect(parseVnpDateTime('20260101070000')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(parseVnpDateTime('2026')).toBeUndefined();
    expect(parseVnpDateTime('abcdefghijklmn')).toBeUndefined();
    expect(parseVnpDateTime('20261301070000')).toBeUndefined();
    expect(parseVnpDateTime('20260101250000')).toBeUndefined();
    expect(parseVnpDateTime(123)).toBeUndefined();
  });
});

describe('vnpay signing', () => {
  it('signs deterministically regardless of key order, as 128 hex chars', () => {
    const forward = signVnpayParams(PAY_PARAMS, SECRET);
    const reversed = signVnpayParams(Object.fromEntries(Object.entries(PAY_PARAMS).reverse()), SECRET);
    expect(forward).toMatch(/^[0-9a-f]{128}$/);
    expect(reversed).toBe(forward);
    expect(signVnpayParams({ ...PAY_PARAMS, vnp_Amount: '4000000' }, SECRET)).not.toBe(forward);
    expect(signVnpayParams(PAY_PARAMS, 'other-secret')).not.toBe(forward);
  });

  it('builds a pay URL carrying the checksum', () => {
    const url = buildVnpayPayUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', PAY_PARAMS, SECRET);
    expect(url).toContain('vnp_TxnRef=VNPAY-ABC');
    expect(url).toMatch(/vnp_SecureHash=[0-9a-f]{128}$/);
  });

  it('encodes values before hashing, like the official VNPay sample', () => {
    // Pinned vector: `:` and `/` in the return URL must reach the hash as %3A/%2F,
    // otherwise the gateway computes a different checksum ("sai chữ ký").
    const url = buildVnpayPayUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', PAY_PARAMS, SECRET);
    expect(url).toContain('vnp_ReturnUrl=https%3A%2F%2Fapi.example.com%2Fapi%2Fpayments%2Fvnpay%2Freturn');
    expect(url).toContain(
      'vnp_SecureHash=5b5733d84a6120d13b4f21054cce7db47edbb468cc20f548d98150418310831d1aaeb1432ead12d0351a8907a36382d9dc07bf223f9116bade4931657eefcaa1',
    );
    // ... including an IPv6 loopback IP, which is all colons.
    const v6 = buildVnpayPayUrl(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      { ...PAY_PARAMS, vnp_IpAddr: '::1' },
      SECRET,
    );
    expect(v6).toContain('vnp_IpAddr=%3A%3A1');
    expect(verifyVnpaySignature(Object.fromEntries(new URL(v6).searchParams.entries()), SECRET)).toBe(true);
  });

  it('verifies its own URLs and rejects anything else', () => {
    const url = buildVnpayPayUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', PAY_PARAMS, SECRET);
    const query = Object.fromEntries(new URL(url).searchParams.entries());
    expect(verifyVnpaySignature(query, SECRET)).toBe(true);
    expect(verifyVnpaySignature({ ...query, vnp_Amount: '4000000' }, SECRET)).toBe(false);
    expect(verifyVnpaySignature(query, 'other-secret')).toBe(false);
    expect(verifyVnpaySignature({ ...query, vnp_SecureHash: undefined }, SECRET)).toBe(false);
    expect(verifyVnpaySignature({ ...query, vnp_SecureHash: 'xyz' }, SECRET)).toBe(false);
    expect(verifyVnpaySignature({ ...query, extra: ['a', 'b'] }, SECRET)).toBe(false);
  });

  it('keeps empty values on both sides of the check, like VNPay itself', () => {
    const withEmpty = { ...PAY_PARAMS, vnp_BankCode: '' };
    expect(signVnpayParams(withEmpty, SECRET)).not.toBe(signVnpayParams(PAY_PARAMS, SECRET));
    const url = buildVnpayPayUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', withEmpty, SECRET);
    expect(url).toContain('vnp_BankCode=');
    expect(verifyVnpaySignature(Object.fromEntries(new URL(url).searchParams.entries()), SECRET)).toBe(true);
  });
});

describe('vnpay querydr signing', () => {
  it('joins the fields with pipes in VNPay order', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(
      vnpayQuerydrRawSignature({
        requestId: 'REQ-1',
        tmnCode: 'TMN123',
        providerTxnId: 'VNPAY-ABC',
        transactionDate: date,
        createDate: date,
        ipAddr: '127.0.0.1',
        orderInfo: 'Query VNPAY-ABC',
      }),
    ).toBe('REQ-1|2.1.0|querydr|TMN123|VNPAY-ABC|20260101070000|20260101070000|127.0.0.1|Query VNPAY-ABC');
  });

  it('signs deterministically as 128 hex chars', () => {
    const params = {
      requestId: 'REQ-1',
      tmnCode: 'TMN123',
      providerTxnId: 'VNPAY-ABC',
      transactionDate: new Date('2026-01-01T00:00:00.000Z'),
      createDate: new Date('2026-01-01T00:05:00.000Z'),
      ipAddr: '127.0.0.1',
      orderInfo: 'Query VNPAY-ABC',
    };
    const first = signVnpayQuerydr(params, SECRET);
    expect(first).toMatch(/^[0-9a-f]{128}$/);
    expect(signVnpayQuerydr(params, SECRET)).toBe(first);
    expect(signVnpayQuerydr({ ...params, requestId: 'REQ-2' }, SECRET)).not.toBe(first);
  });
});

describe('VNPAY_RSP', () => {
  it('matches the codes VNPay retries on', () => {
    expect(VNPAY_RSP).toMatchObject({
      OK: '00',
      ORDER_NOT_FOUND: '01',
      ALREADY_CONFIRMED: '02',
      INVALID_AMOUNT: '04',
      CHECKSUM_FAILED: '97',
      UNKNOWN_ERROR: '99',
    });
  });
});
