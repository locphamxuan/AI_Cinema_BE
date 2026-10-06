import { NotFoundException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';

export function providerOf(value: string): PaymentProvider {
  const provider = value?.toUpperCase();
  if (provider === PaymentProvider.VNPAY || provider === PaymentProvider.MOMO) return provider;
  throw new NotFoundException({ message: 'Payment provider not found', details: { reason: 'PROVIDER_NOT_FOUND' } });
}
