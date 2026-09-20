import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ComplianceCheckType, ComplianceResult } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateComplianceCheckRequestDto {
  @ApiProperty({
    example: 'AI_LABEL_PRESENCE',
    description: 'Type of compliance verification.',
    enum: ComplianceCheckType,
  })
  @IsEnum(ComplianceCheckType)
  checkType: ComplianceCheckType;

  @ApiProperty({
    example: 'c4e5d6f7-a8b9-0123-cdef-456789abcdef',
    description: 'UUID of the policy this check runs against.',
  })
  @IsUUID()
  policyId: string;

  @ApiPropertyOptional({
    description:
      'Only used for manual checks (CONTENT_POLICY/COPYRIGHT/LEGAL). AI_LABEL_PRESENCE is evaluated automatically from existing labels.',
    enum: ComplianceResult,
  })
  @IsEnum(ComplianceResult)
  @IsOptional()
  result?: ComplianceResult;

  @ApiPropertyOptional({
    example: 'system-ai-compliance',
    description: 'Name of the automated system performing the check.',
  })
  @IsString()
  @IsOptional()
  checkedBySystem?: string;

  @ApiPropertyOptional({ example: 'Một cảnh chưa được gắn nhãn.', description: 'Reason when the check fails.' })
  @IsString()
  @IsOptional()
  failureReason?: string;
}
