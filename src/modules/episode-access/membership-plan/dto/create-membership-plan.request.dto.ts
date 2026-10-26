import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanPeriod } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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

  @ApiProperty({ enum: [PlanPeriod.MONTHLY], example: PlanPeriod.MONTHLY })
  @IsIn([PlanPeriod.MONTHLY])
  period: PlanPeriod;

  @ApiProperty({ example: 30, minimum: 1, description: 'Calendar days one cycle covers' })
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;

  @ApiPropertyOptional({ example: false, description: 'The free plan has no price row and no subscription' })
  @IsBoolean()
  @IsOptional()
  isFree?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Order on the plan screen' })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, description: 'Shown as the recommended plan' })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    example: { maxRegisteredDevices: 4, maxConcurrentStreams: 2, adFree: true, maxQuality: '1080p' },
  })
  @IsObject()
  @IsOptional()
  features?: Record<string, unknown>;
}
