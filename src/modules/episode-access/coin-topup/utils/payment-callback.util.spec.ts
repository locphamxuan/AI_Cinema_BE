import { BadRequestException } from '@nestjs/common';
import { normalizeCallback } from './payment-callback.util';

describe('normalizeCallback', () => {
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
