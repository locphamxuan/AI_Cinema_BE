import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';
import { IsString, Length, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';

export class CreateMembershipPlanRequestDto {
  @ApiProperty({ example: 'premium_monthly', description: 'Short key of the plan, unique' })
  @IsString()
  @Length(2, 50)
  code: string;

  @ApiProperty({ example: 'Premium Tháng' })
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiPropertyOptional({ example: 'Xem mọi tập, không quảng cáo' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: PlanPeriod, example: PlanPeriod.MONTHLY })
  @IsEnum(PlanPeriod)
  period: PlanPeriod;

  @ApiProperty({ example: 30, minimum: 1, description: 'Calendar days one cycle covers' })
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;

  @ApiPropertyOptional({ example: false, description: 'The free plan has no price row and no subscription' })
  @IsOptional()
  isFree?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Order on the plan screen' })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, description: 'Shown as the recommended plan' })
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional({ example: { maxDevices: 2, adFree: true, maxQuality: '1080p' } })
  @IsOptional()
  features?: Record<string, unknown>;
}
