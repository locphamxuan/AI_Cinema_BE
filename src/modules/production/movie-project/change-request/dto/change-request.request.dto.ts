import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChangeRequestStatus, ChangeRequestType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

/** A Reviewer or Creator asks the Admin for a change, sent as multipart so the proof can travel with it (BR-55). */
export class ProposeChangeRequestDto {
  @ApiPropertyOptional({ enum: ChangeRequestType, default: ChangeRequestType.PROJECT_UPDATE })
  @IsEnum(ChangeRequestType)
  @IsOptional()
  requestType?: ChangeRequestType;

  @ApiProperty({ example: 'Thêm 2 tập vào mùa 1 và tăng đơn giá mùa lên 6000 Token/tập.' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  content: string;

  @ApiProperty({ example: 'Studio báo giá lại vì kịch bản dài hơn dự kiến.' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  reason: string;

  @ApiPropertyOptional({
    example: 12000,
    description: 'Token asked for; required for BUDGET_SUPPLEMENT, refused otherwise.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  @IsOptional()
  requestedTokens?: number;

  @ApiPropertyOptional({ description: 'The season the request is about.' })
  @IsUUID('4')
  @IsOptional()
  seasonId?: string;

  @ApiPropertyOptional({ description: 'The episode the request is about; with neither id the whole project.' })
  @IsUUID('4')
  @IsOptional()
  episodeId?: string;
}

export class ResolveChangeRequestDto {
  @ApiPropertyOptional({ description: 'Answer to the requester; required when rejecting.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  response?: string;
}

export class ChangeRequestListQueryDto {
  @ApiPropertyOptional({ enum: ChangeRequestStatus })
  @IsEnum(ChangeRequestStatus)
  @IsOptional()
  status?: ChangeRequestStatus;
}
