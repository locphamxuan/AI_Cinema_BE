import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class SetPlanPriceRequestDto {
  @ApiProperty({ example: 300, minimum: 1, description: 'Coin price of one cycle' })
  @IsInt()
  @Min(1)
  priceCoins: number;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'When the new price starts; now when omitted',
  })
  @IsDateString()
  @IsOptional()
  @Type(() => Date)
  effectiveFrom?: Date;
}
