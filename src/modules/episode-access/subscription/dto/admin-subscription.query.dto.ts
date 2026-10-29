import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { PageQueryDto } from 'src/common/validation/page-query.dto';
import { EmptyAsUnset } from 'src/common/validation/trim';

/** Filters of the Admin subscription list; the page keys (`page`, `limit`, `sortBy`, ...) come along. */
export class AdminSubscriptionQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @EmptyAsUnset()
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @EmptyAsUnset()
  @IsString()
  @IsOptional()
  planId?: string;

  @ApiPropertyOptional()
  @EmptyAsUnset()
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @EmptyAsUnset()
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @EmptyAsUnset()
  @IsDateString()
  @IsOptional()
  to?: string;
}
