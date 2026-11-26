import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

/** One prize switched on, with its chance in basis points. */
export class PrizeChanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id: string;

  @ApiProperty({ example: 2500, description: 'Chance in basis points: 1 = 0.01 %, 10 000 = 100 %' })
  @IsInt()
  @Min(1)
  @Max(10_000)
  weight: number;
}

/** The whole wheel in one save: the prizes listed are switched on, every other prize is switched off. */
export class SetRewardChancesRequestDto {
  @ApiProperty({ type: [PrizeChanceDto], description: 'Their weights must add up to exactly 10 000 (100 %)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PrizeChanceDto)
  prizes: PrizeChanceDto[];
}
