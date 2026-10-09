import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider, TopUpStatus } from '@prisma/client';

export class CoinTopUpView {
  @ApiProperty()
  topUpId: string;

  @ApiProperty({ enum: PaymentProvider })
  provider: PaymentProvider;

  @ApiProperty({ description: 'Gateway order id; the callback finds its order with it' })
  providerTxnId: string | null;

  @ApiProperty({ example: 50000 })
  amountVnd: number;

  @ApiProperty({ example: 50 })
  coinsGranted: number;

  @ApiProperty({ example: 1000 })
  rateVnd: number;

  @ApiProperty({ enum: TopUpStatus })
  status: TopUpStatus;

  @ApiProperty({ nullable: true, description: 'Where the gateway expects the member' })
  redirectUrl: string | null;

  @ApiProperty({ nullable: true })
  failureReason: string | null;

  @ApiProperty({ nullable: true })
  paidAt: Date | null;

  @ApiProperty({ nullable: true })
  expiresAt: Date | null;
}
