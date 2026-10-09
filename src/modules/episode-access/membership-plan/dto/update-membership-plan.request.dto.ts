import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';
import { IsString, Length, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';

export class UpdateMembershipPlanRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 255)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: PlanPeriod })
  @IsEnum(PlanPeriod)
  @IsOptional()
  period?: PlanPeriod;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  durationDays?: number;

  @ApiPropertyOptional({ description: 'Show or hide the plan' })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  features?: Record<string, unknown>;
}
