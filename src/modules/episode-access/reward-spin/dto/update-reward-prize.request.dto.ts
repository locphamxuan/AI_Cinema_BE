import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Trim } from 'src/common/validation/trim';
import { MAX_REWARD_BONUS_COINS } from '../../daily-reward/reward-ladder';

/** Edits a prize; its type stays, so the amount edited must be the one that type uses. */
export class UpdateRewardPrizeRequestDto {
  @ApiPropertyOptional({ example: '80 Coin thưởng' })
  @Trim()
  @IsString()
  @Length(1, 255)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Only for a BONUS_COIN prize' })
  @IsInt()
  @Min(1)
  @Max(MAX_REWARD_BONUS_COINS)
  @IsOptional()
  bonusCoins?: number;

  @ApiPropertyOptional({ description: 'Only for a PLAN_DAYS prize' })
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  planDays?: number;

  @ApiPropertyOptional({ description: 'Chance in basis points (10 000 = 100 %); the wheel must still add up to 100 %' })
  @IsInt()
  @Min(1)
  @Max(10_000)
  @IsOptional()
  weight?: number;

  @ApiPropertyOptional({
    description:
      'Switch the prize off the wheel (false) or back on (true); refused when the wheel would not add up to 100 %, or for the last active prize while members hold spins',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
