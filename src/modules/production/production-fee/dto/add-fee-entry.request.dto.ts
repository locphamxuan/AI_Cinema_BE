import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TokenEntryType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

const MAX_TOKENS = 1_000_000_000;

export class AddFeeEntryRequestDto {
  @ApiProperty({ enum: TokenEntryType, example: TokenEntryType.INITIAL })
  @IsEnum(TokenEntryType)
  entryType: TokenEntryType;

  @ApiPropertyOptional({
    description:
      'The season the entry is priced for. Required for INITIAL (episode price × episodes); optional for a top-up or correction.',
  })
  @IsUUID('4')
  @IsOptional()
  seasonId?: string;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Token to add; a CORRECTION may be negative. Ignored for INITIAL, which is computed from the season.',
  })
  @IsInt()
  @Min(-MAX_TOKENS)
  @Max(MAX_TOKENS)
  @IsOptional()
  amountTokens?: number;

  @ApiPropertyOptional({
    example: 'The studio added two VFX-heavy scenes.',
    description: 'Required except for INITIAL.',
  })
  @Trim()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
