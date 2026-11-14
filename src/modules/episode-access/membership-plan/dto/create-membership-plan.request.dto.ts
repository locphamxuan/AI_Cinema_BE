import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MONTHLY_DAYS, PLAN_CODE_PATTERN } from './plan-rules';
import { PlanFeaturesDto } from './plan-features.dto';

export class CreateMembershipPlanRequestDto {
  @ApiProperty({ example: 'premium_monthly', description: 'Short key of the plan, unique: letters, digits, _ or -' })
  @IsString()
  @Length(2, 50)
  @Matches(PLAN_CODE_PATTERN, { message: 'code may only hold letters, digits, _ and -' })
  code: string;

  @ApiProperty({ example: 'Premium Tháng' })
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiPropertyOptional({ example: 'Xem mọi tập, không quảng cáo' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: [PlanPeriod.MONTHLY], example: PlanPeriod.MONTHLY })
  @IsIn([PlanPeriod.MONTHLY])
  period: PlanPeriod;

  @ApiProperty({
    example: 30,
    minimum: MONTHLY_DAYS.min,
    maximum: MONTHLY_DAYS.max,
    description: 'Calendar days one monthly cycle covers',
  })
  @IsInt()
  @Min(MONTHLY_DAYS.min)
  @Max(MONTHLY_DAYS.max)
  durationDays: number;

  @ApiPropertyOptional({ example: false, description: 'The free plan has no price row and no subscription' })
  @IsBoolean()
  @IsOptional()
  isFree?: boolean;

  @ApiPropertyOptional({ example: 10, minimum: 0, description: 'Order on the plan screen, smallest first' })
  @IsInt()
  @Min(0)
  @Max(999)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, description: 'Shown as the recommended plan' })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional({ type: PlanFeaturesDto })
  @ValidateNested()
  @Type(() => PlanFeaturesDto)
  @IsOptional()
  features?: PlanFeaturesDto;
}
