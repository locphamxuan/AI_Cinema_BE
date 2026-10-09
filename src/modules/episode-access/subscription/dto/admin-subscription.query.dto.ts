import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';

export class AdminSubscriptionQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  planId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsDateString()
  @IsOptional()
  to?: string;
}
