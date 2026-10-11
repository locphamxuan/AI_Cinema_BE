import { BadRequestException } from '@nestjs/common';
import { normalizeCallback } from './payment-callback.util';

describe('normalizeCallback', () => {
  it('reads a MoMo IPN, whose transId and amount arrive as JSON numbers', () => {
    const topUpId = 'f0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b';
    const callback = normalizeCallback({
      orderId: 'MOMO-ABC',
      amount: 20000,
      resultCode: 0,
      transId: 4088878653,
      signature: 'sig',
      extraData: Buffer.from(JSON.stringify({ topUpId })).toString('base64'),
    });
    expect(callback).toMatchObject({
      eventId: '4088878653',
      providerPaymentId: '4088878653',
      providerTxnId: 'MOMO-ABC',
      topUpId,
      amountVnd: 20000,
      status: 'success',
    });
  });

  it('reads a VNPay delivery: the amount times 100, success only when both codes read 00', () => {
    const base = { vnp_TxnRef: 'VNPAY-1', vnp_Amount: '2000000', vnp_SecureHash: 'h', vnp_ResponseCode: '00' };
    expect(normalizeCallback({ ...base, vnp_TransactionNo: '14' })).toMatchObject({
      eventId: '14',
      amountVnd: 20000,
      status: 'success',
    });
    expect(normalizeCallback({ ...base, vnp_TransactionStatus: '02' })).toMatchObject({
      eventId: 'VNPAY-1:00',
      status: 'failed',
    });
  });

  it('refuses a delivery without a signature, or without an event id, amount or status', () => {
    expect(() => normalizeCallback({ eventId: 'e', amountVnd: 1, status: 'success' })).toThrow(BadRequestException);
    expect(() => normalizeCallback({ signature: 's', amountVnd: 1, status: 'success' })).toThrow(BadRequestException);
    expect(() => normalizeCallback({ signature: 's', eventId: 'e', status: 'odd' })).toThrow(BadRequestException);
  });
});
