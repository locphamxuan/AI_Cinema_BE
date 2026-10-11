import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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

  @ApiPropertyOptional({ enum: [PlanPeriod.MONTHLY] })
  @IsIn([PlanPeriod.MONTHLY])
  @IsOptional()
  period?: PlanPeriod;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  durationDays?: number;

  @ApiPropertyOptional({ description: 'Show or hide the plan' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  features?: Record<string, unknown>;
}
