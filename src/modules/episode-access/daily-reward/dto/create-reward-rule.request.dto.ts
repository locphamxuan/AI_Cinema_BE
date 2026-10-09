import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, IsInt, Min, Max, IsOptional } from 'class-validator';

/** A rung of the streak ladder: what streak day `streakDay` pays. */
export class CreateRewardRuleRequestDto {
  @ApiProperty({ example: 'streak_day_7', description: 'Short key of the rule, unique' })
  @IsString()
  @Length(3, 50)
  code: string;

  @ApiProperty({ example: 'Ngày thứ 7 trong chuỗi' })
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({ example: 7, minimum: 1, maximum: 31, description: '1 = the first day of a streak' })
  @IsInt()
  @Min(1)
  @Max(31)
  streakDay: number;

  @ApiProperty({ example: 10, description: 'Main Coins this day pays' })
  @IsInt()
  @Min(0)
  coins: number;

  @ApiPropertyOptional({ example: 5, description: 'Bonus Coins on top, only on this day' })
  @IsInt()
  @Min(0)
  @IsOptional()
  bonusCoins?: number;
}
