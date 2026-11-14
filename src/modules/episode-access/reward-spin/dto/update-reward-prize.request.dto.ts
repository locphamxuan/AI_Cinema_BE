import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Edits a prize; its type stays, so the amount edited must be the one that type uses. */
export class UpdateRewardPrizeRequestDto {
  @ApiPropertyOptional({ example: '80 Coin thưởng' })
  @IsString()
  @Length(1, 255)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Only for a BONUS_COIN prize' })
  @IsInt()
  @Min(1)
  @IsOptional()
  bonusCoins?: number;

  @ApiPropertyOptional({ description: 'Only for a PLAN_DAYS prize' })
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  planDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  @IsOptional()
  weight?: number;

  @ApiPropertyOptional({ description: 'Take the prize off the wheel (false) or put it back (true)' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
