import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TokenRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

const MAX_TOKENS = 1_000_000_000;

/** A Creator asks the Reviewer for more Token for a season, e.g. because the studio did not accept the fee. */
export class CreateTokenRequestDto {
  @ApiProperty({ description: 'The season the extra Token is for.' })
  @IsUUID('4')
  seasonId: string;

  @ApiProperty({ example: 4000 })
  @IsInt()
  @Min(1)
  @Max(MAX_TOKENS)
  requestedTokens: number;

  @ApiProperty({ example: 'Studio từ chối mức 3000 Token/tập, đề nghị 4000 Token/tập.' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}

export class ApproveTokenRequestDto {
  @ApiPropertyOptional({ description: 'Token to grant; defaults to what was asked for, never more.' })
  @IsInt()
  @Min(1)
  @Max(MAX_TOKENS)
  @IsOptional()
  grantedTokens?: number;
}

export class RejectTokenRequestDto {
  @ApiProperty()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  response: string;
}

export class TokenRequestListQueryDto {
  @ApiPropertyOptional({ enum: TokenRequestStatus })
  @IsEnum(TokenRequestStatus)
  @IsOptional()
  status?: TokenRequestStatus;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
