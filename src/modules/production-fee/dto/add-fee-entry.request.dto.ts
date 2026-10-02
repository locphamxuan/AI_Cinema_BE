import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TokenEntryType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const MAX_TOKENS = 1_000_000_000;

export class AddFeeEntryRequestDto {
  @ApiProperty({ enum: TokenEntryType, example: TokenEntryType.INITIAL })
  @IsEnum(TokenEntryType)
  entryType: TokenEntryType;

  @ApiProperty({ example: 50000, description: 'Token to add; a CORRECTION may be negative. 1 Token = rate VND.' })
  @IsInt()
  @Min(-MAX_TOKENS)
  @Max(MAX_TOKENS)
  amountTokens: number;

  @ApiPropertyOptional({
    example: 'The studio added two VFX-heavy scenes.',
    description: 'Required except for INITIAL.',
  })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
