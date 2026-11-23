import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PLAN_PRICE_COINS } from './plan-rules';

export class SetPlanPriceRequestDto {
  @ApiProperty({ example: 300, minimum: 1, maximum: MAX_PLAN_PRICE_COINS, description: 'Coin price of one cycle' })
  @IsInt()
  @Min(1)
  @Max(MAX_PLAN_PRICE_COINS)
  priceCoins: number;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'When the new price starts; now when omitted. Never in the past.',
  })
  // Converted to a Date before validation, so the check is on the Date (an ISO string check always failed).
  @IsDate()
  @IsOptional()
  @Type(() => Date)
  effectiveFrom?: Date;
}
