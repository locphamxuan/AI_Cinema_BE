import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewerTokenEntryType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** The Admin gives a Reviewer Token, or takes back part of what is left (with a reason). */
export class AddReviewerTokenEntryRequestDto {
  @ApiProperty({ enum: ReviewerTokenEntryType })
  @IsEnum(ReviewerTokenEntryType)
  entryType: ReviewerTokenEntryType;

  @ApiProperty({ example: 500000, description: 'Always positive; REVOKE takes this many Token back.' })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountTokens: number;

  @ApiPropertyOptional({ example: 'Ngân sách quý 4 cho dòng phim kinh dị.', description: 'Required for REVOKE.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
