import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceCheckType, ComplianceResult } from '@prisma/client';

export class ComplianceCheckAnswerDto {
  @ApiProperty({ example: 'WATERMARK', enum: ComplianceCheckType })
  @IsEnum(ComplianceCheckType)
  checkType: ComplianceCheckType;

  @ApiProperty({ example: 'PASS', enum: [ComplianceResult.PASS, ComplianceResult.FAIL] })
  @IsIn([ComplianceResult.PASS, ComplianceResult.FAIL])
  result: ComplianceResult;

  @ApiPropertyOptional({
    example: 'Watermark missing from 12:40 onwards',
    description: 'Required when result is FAIL.',
  })
  @IsString()
  @IsOptional()
  failureReason?: string;
}

export class RecordComplianceReviewRequestDto {
  @ApiProperty({ example: 'c4e5d6f7-a8b9-0123-cdef-456789abcdef', description: 'Policy the checks run against.' })
  @IsUUID()
  policyId: string;

  @ApiProperty({
    type: [ComplianceCheckAnswerDto],
    description: 'One answer per manual check type (every type except AI_LABEL_PRESENCE, which is automatic).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ComplianceCheckAnswerDto)
  checks: ComplianceCheckAnswerDto[];
}
