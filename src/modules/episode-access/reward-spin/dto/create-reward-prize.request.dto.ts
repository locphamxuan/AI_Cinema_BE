import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RewardPrizeType } from '@prisma/client';
import { IsEnum, IsInt, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

/** One slot of the reward wheel (BR-09): bonus Coins or days of the monthly plan, with a weight. */
export class CreateRewardPrizeRequestDto {
  @ApiProperty({ example: 'bonus_50', description: 'Short key of the prize, unique' })
  @IsString()
  @Length(3, 50)
  code: string;

  @ApiProperty({ example: '50 Coin thưởng' })
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
  bonusCoins?: number;

  @ApiPropertyOptional({ example: 3, description: 'Required for PLAN_DAYS, ignored otherwise' })
  @ValidateIf((dto: CreateRewardPrizeRequestDto) => dto.type === RewardPrizeType.PLAN_DAYS)
  @IsInt()
  @Min(1)
  @Max(30)
  planDays?: number;

  @ApiProperty({ example: 60, description: 'Chance = weight / sum of the active weights' })
  @IsInt()
  @Min(1)
  @Max(10_000)
  weight: number;
}
