import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceResult, ContentReviewDecision, LabelType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Steps 8–9: approve the delivered version or send it back with feedback for the studio. */
export class ReviewMediaRequestDto {
  @ApiProperty({ enum: ContentReviewDecision })
  @IsEnum(ContentReviewDecision)
  decision: ContentReviewDecision;

  @ApiPropertyOptional({
    example: 'Phút 03:10 nhân vật chính bị méo mặt, nhờ studio render lại cảnh này.',
    description: 'Required when changes are requested; the Creator forwards it to the studio (BR-18)',
  })
  @ValidateIf((dto: ReviewMediaRequestDto) => dto.decision === ContentReviewDecision.CHANGES_REQUESTED)
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  comments?: string;
}

export const LABEL_LOCATIONS = ['TOP_RIGHT', 'TOP_LEFT', 'BOTTOM_RIGHT', 'BOTTOM_LEFT', 'INTRO_NOTICE'] as const;

/** Step 10: the Reviewer's final AI label of the approved version (BR-40). */
export class ApplyAiLabelRequestDto {
  @ApiProperty({ enum: LabelType })
  @IsEnum(LabelType)
  labelType: LabelType;

  @ApiProperty({ example: 'Phim được tạo bằng trí tuệ nhân tạo (AI)' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  labelText: string;

  @ApiPropertyOptional({ enum: LABEL_LOCATIONS, default: 'TOP_RIGHT' })
  @IsIn(LABEL_LOCATIONS)
  @IsOptional()
  displayLocation?: (typeof LABEL_LOCATIONS)[number];
}

const DECIDED = [ComplianceResult.PASS, ComplianceResult.FAIL] as const;

/** One compliance item the Reviewer judges by watching the episode. */
export class ComplianceItemDto {
  @ApiProperty({ enum: DECIDED })
  @IsIn(DECIDED)
  result: 'PASS' | 'FAIL';

  @ApiPropertyOptional({ description: 'Required when the item fails' })
  @ValidateIf((item: ComplianceItemDto) => item.result === ComplianceResult.FAIL)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  failureReason?: string;
}

/**
 * Step 11 (BR-42). The AI label item is checked by the system; the real-person item passes only
 * when the studio committed to it and the Reviewer saw no misleading real person or event.
 */
export class RunComplianceRequestDto {
  @ApiProperty({ type: ComplianceItemDto, description: 'Decree 142: a notice where viewers could be misled' })
  @IsDefined()
  @IsObject()
  @Type(() => ComplianceItemDto)
  @ValidateNested()
  decree142Notice: ComplianceItemDto;

  @ApiProperty({ type: ComplianceItemDto, description: 'No extreme violence, sexual content, hate or illegal content' })
  @IsDefined()
  @IsObject()
  @Type(() => ComplianceItemDto)
  @ValidateNested()
  contentSafety: ComplianceItemDto;

  @ApiProperty({ description: 'Whether the episode depicts a real person or event in a misleading way' })
  @IsBoolean()
  depictsRealPersonOrEvent: boolean;

  @ApiPropertyOptional({ description: 'What the misleading depiction is, when there is one' })
  @ValidateIf((dto: RunComplianceRequestDto) => dto.depictsRealPersonOrEvent === true)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  realPersonNote?: string;
}
