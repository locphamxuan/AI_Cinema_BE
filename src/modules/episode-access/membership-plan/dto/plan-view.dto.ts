import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';

export class PlanView {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiProperty({ enum: PlanPeriod })
  period: PlanPeriod;

  @ApiProperty()
  durationDays: number;

  @ApiProperty()
  isFree: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  isFeatured: boolean;

  @ApiPropertyOptional({
    example: { maxDevices: 2, adFree: true },
  })
  features: unknown;

  @ApiProperty({
    nullable: true,
    description: 'Coin price of one cycle, the price in force',
  })
  priceCoins: number | null;
}
