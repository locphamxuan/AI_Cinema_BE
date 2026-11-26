import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RewardPrizeType } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { Trim } from 'src/common/validation/trim';
import { MAX_REWARD_BONUS_COINS } from '../../daily-reward/reward-ladder';

/** One slot of the reward wheel (BR-09): bonus Coins or days of the monthly plan, with its chance. */
export class CreateRewardPrizeRequestDto {
  @ApiProperty({ example: 'bonus_50', description: 'Short key of the prize, unique; the back office makes it up' })
  @Trim()
  @IsString()
  @Length(3, 50)
  code: string;

  @ApiProperty({ example: '50 Coin thưởng' })
  @Trim()
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({ enum: RewardPrizeType })
  @IsEnum(RewardPrizeType)
  type: RewardPrizeType;

  @ApiPropertyOptional({ example: 50, description: 'Required for BONUS_COIN, ignored otherwise' })
  @ValidateIf((dto: CreateRewardPrizeRequestDto) => dto.type === RewardPrizeType.BONUS_COIN)
  @IsInt()
  @Min(1)
  @Max(MAX_REWARD_BONUS_COINS)
  bonusCoins?: number;

  @ApiPropertyOptional({ example: 3, description: 'Required for PLAN_DAYS, ignored otherwise' })
  @ValidateIf((dto: CreateRewardPrizeRequestDto) => dto.type === RewardPrizeType.PLAN_DAYS)
  @IsInt()
  @Min(1)
  @Max(30)
  planDays?: number;

  @ApiProperty({
    example: 2500,
    description: 'Chance in basis points (1 = 0.01 %, 10 000 = 100 %); the prizes switched on must add up to 100 %',
  })
  @IsInt()
  @Min(1)
  @Max(10_000)
  weight: number;

  @ApiPropertyOptional({
    default: true,
    description: 'false adds the prize switched off; its chance then counts once the wheel is rebalanced',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
