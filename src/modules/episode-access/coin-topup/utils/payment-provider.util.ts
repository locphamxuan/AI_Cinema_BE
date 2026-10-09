import { NotFoundException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';

export function providerOf(value: string): PaymentProvider {
  const provider = value?.toUpperCase();
  if (provider === PaymentProvider.VNPAY || provider === PaymentProvider.MOMO) return provider;
  throw new NotFoundException({ message: 'Payment provider not found', details: { reason: 'PROVIDER_NOT_FOUND' } });
}

/**
 * Where the member pays. A placeholder the gateway adapter replaces with the signed payment URL;
 * it carries the gateway order id so the callback finds its attempt either way.
 */
export function redirectOf(provider: PaymentProvider, providerTxnId: string, amountVnd: number): string {
  const order = encodeURIComponent(providerTxnId);
  if (provider === PaymentProvider.MOMO) {
    return `https://test-payment.momo.vn/v2/gateway/pay?orderId=${order}&amount=${amountVnd}`;
  }
  return `https://sandbox.vnpayment.vn/tryitnow/Home/CreateOrder?orderId=${order}&amount=${amountVnd}`;
}
