import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Documented shape of a gateway webhook delivery. VNPay (`vnp_*`) and MoMo IPN fields are
 * accepted too and normalised to this shape; the raw payload is always kept for reconciliation.
 */
export class PaymentCallbackRequestDto {
  @ApiProperty({ example: 'vnp_12345678', description: 'Gateway event id; unique together with the provider' })
  eventId: string;

  @ApiPropertyOptional({ description: 'Our top-up id, when the gateway echoes it back' })
  topUpId?: string;

  @ApiPropertyOptional({ example: 'VNPAY-MABCD1234', description: 'Gateway order id of the top-up' })
  providerTxnId?: string;

  @ApiProperty({ example: 50000, description: 'VND the gateway reports; must match the order' })
  amountVnd: number;

  @ApiProperty({ enum: ['success', 'failed', 'cancelled'], example: 'success' })
  status: 'success' | 'failed' | 'cancelled';

  @ApiPropertyOptional({ description: 'Gateway transaction id of the settled payment' })
  providerPaymentId?: string;

  @ApiProperty({ description: 'Gateway signature; refused when missing' })
  signature: string;

  @ApiPropertyOptional({ example: '2026-10-05T03:10:00.000Z' })
  paidAt?: string;
}
