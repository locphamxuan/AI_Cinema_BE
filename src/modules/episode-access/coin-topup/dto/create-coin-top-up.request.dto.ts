import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsInt, Min } from 'class-validator';

/** Step 12: which gateway to pay with, and how much VND to hand over. */
export class CreateCoinTopUpRequestDto {
  @ApiProperty({ enum: PaymentProvider, example: PaymentProvider.VNPAY })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({ example: 50000, minimum: 10000, description: 'VND handed to the gateway' })
  @IsInt()
  @Min(1000)
  amountVnd: number;
}
