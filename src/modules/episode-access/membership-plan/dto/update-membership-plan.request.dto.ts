import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MONTHLY_DAYS } from './plan-rules';
import { PlanFeaturesDto } from './plan-features.dto';

export class UpdateMembershipPlanRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 255)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: [PlanPeriod.MONTHLY] })
  @IsIn([PlanPeriod.MONTHLY])
  @IsOptional()
  period?: PlanPeriod;

  @ApiPropertyOptional({ minimum: MONTHLY_DAYS.min, maximum: MONTHLY_DAYS.max })
  @IsInt()
  @Min(MONTHLY_DAYS.min)
  @Max(MONTHLY_DAYS.max)
  @IsOptional()
  durationDays?: number;

  @ApiPropertyOptional({ description: 'Show or hide the plan' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(999)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional({ type: PlanFeaturesDto })
  @ValidateNested()
  @Type(() => PlanFeaturesDto)
  @IsOptional()
  features?: PlanFeaturesDto;
}
