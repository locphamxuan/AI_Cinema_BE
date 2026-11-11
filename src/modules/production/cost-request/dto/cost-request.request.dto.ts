import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CostRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';
import { IsVnd } from 'src/modules/production/production-cost/dto/vnd';

/**
 * The Reviewer asks the Admin for more production cost, sent as multipart so the studio quote travels with it
 * (field `proof`).
 */
export class CreateCostRequestDto {
  @ApiProperty({ example: 20_000_000, description: 'VND asked for, in whole thousands.' })
  @IsVnd()
  requestedVnd: number;

  @ApiPropertyOptional({ example: 170_000_000, description: 'What the studio quoted, when known.' })
  @IsVnd()
  @IsOptional()
  studioQuoteVnd?: number;

  @ApiPropertyOptional({ description: 'The hand-off whose studio asked for more.' })
  @IsUUID('4')
  @IsOptional()
  handoffId?: string;

  @ApiProperty({ example: 'Studio từ chối 150 triệu, báo giá 170 triệu vì thêm cảnh VFX.' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  reason: string;
}

export class ApproveCostRequestDto {
  @ApiPropertyOptional({ description: 'VND to grant; defaults to what was asked for, never more.' })
  @IsVnd()
  @IsOptional()
  grantedVnd?: number;

  @ApiPropertyOptional({ description: 'Note to the Reviewer, e.g. why less was granted.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  response?: string;
}

export class RejectCostRequestDto {
  @ApiProperty()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  response: string;
}

export class CostRequestListQueryDto {
  @ApiPropertyOptional({ enum: CostRequestStatus })
  @IsEnum(CostRequestStatus)
  @IsOptional()
  status?: CostRequestStatus;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
