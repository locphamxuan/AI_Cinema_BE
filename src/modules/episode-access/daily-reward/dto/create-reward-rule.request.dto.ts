import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { LADDER_LENGTH } from '../reward-ladder';

/** A rung of the streak ladder: what streak day `streakDay` pays, in bonus Coins only (BR-05). */
export class CreateRewardRuleRequestDto {
  @ApiProperty({ example: 'streak_day_7', description: 'Short key of the rule, unique' })
  @IsString()
  @Length(3, 50)
  code: string;

  @ApiProperty({ example: 'Ngày thứ 7 trong chuỗi' })
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({ example: 7, minimum: 1, maximum: LADDER_LENGTH, description: '1 = the first day of a streak' })
  @IsInt()
  @Min(1)
  @Max(LADDER_LENGTH)
  streakDay: number;

  @ApiProperty({ example: 10, description: 'Bonus Coins this day pays' })
  @IsInt()
  @Min(1)
  bonusCoins: number;

  @ApiPropertyOptional({ example: true, description: 'Milestone day: checking in also grants a reward spin (BR-09)' })
  @IsBoolean()
  @IsOptional()
  grantsSpin?: boolean;
}
