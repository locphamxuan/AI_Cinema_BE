import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

export class AffordabilityQueryDto {
  @ApiProperty({
    example: 25,
    description: 'Number of Coins to check whether the user can afford',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  amountCoins: number;
}
