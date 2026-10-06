import { NotFoundException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { providerOf } from './payment-provider.util';

describe('providerOf', () => {
  it.each([['VNPAY'], ['vnpay'], ['VnPay']])('accepts %s as VNPay', (value) => {
    expect(providerOf(value)).toBe(PaymentProvider.VNPAY);
  });

  it.each([['MOMO'], ['momo']])('accepts %s as MoMo', (value) => {
    expect(providerOf(value)).toBe(PaymentProvider.MOMO);
  });

  it('answers 404 with PROVIDER_NOT_FOUND for anything else', () => {
    for (const value of ['ZALOPAY', '', 'vnp']) {
      const error = ((() => {
        try {
          providerOf(value);
          return null;
        } catch (e) {
          return e;
        }
      })()) as NotFoundException | null;
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.getResponse()).toMatchObject({ details: { reason: 'PROVIDER_NOT_FOUND' } });
    }
  });
});
