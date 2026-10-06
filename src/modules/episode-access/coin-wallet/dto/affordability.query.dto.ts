import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

export class AffordabilityQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  amountCoins: number;
}
