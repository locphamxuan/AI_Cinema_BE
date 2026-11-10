import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

/** The lead Creator submits a (new version of the) script to the Reviewer. */
export class SubmitScriptRequestDto {
  @ApiProperty({ description: 'Full text of the script.', example: 'CẢNH 1 — NỘI. CĂN HỘ — ĐÊM ...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000)
  content: string;

  @ApiPropertyOptional({ description: 'What changed since the previous version.' })
  @Trim()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;
}

/** The Reviewer passes the submitted version on to the Admin, or sends it back with a comment. */
export class ReviewScriptRequestDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ description: 'Required when the script is sent back.' })
  @Trim()
  @ValidateIf((dto: ReviewScriptRequestDto) => !dto.approve || dto.comment !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  comment?: string;
}

/** The Admin approves the Final Script (the studio then gets its template contract) or sends it back. */
export class FinalReviewScriptRequestDto extends ReviewScriptRequestDto {
  @ApiPropertyOptional({ description: 'Studio to contract, when the project has none yet.' })
  @IsUUID('4')
  @IsOptional()
  studioId?: string;

  @ApiPropertyOptional({ description: 'Working terms of the template contract; a standard clause otherwise.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  terms?: string;
}
