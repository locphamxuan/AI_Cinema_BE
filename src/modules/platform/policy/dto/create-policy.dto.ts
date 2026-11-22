import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { PolicyType } from '@prisma/client';

export class CreatePolicyDto {
  @ApiProperty({ example: 'AI-Generated Content Labeling Policy', description: 'Name of the policy.' })
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({ example: 'AI_LABELING', enum: PolicyType })
  @IsEnum(PolicyType)
  type: PolicyType;

  @ApiProperty({ example: '1.0.0', description: 'Version of the policy.' })
  @IsString()
  @Length(1, 50)
  version: string;

  @ApiPropertyOptional({
    example: 'Điều 44 Luật số 134/2025/QH15',
    description: 'Legal document reference of the policy.',
  })
  @IsOptional()
  @IsString()
  documentReference?: string;

  @ApiPropertyOptional({ description: 'Structured content and requirements of the policy.' })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '2026-05-01T00:00:00.000Z', description: 'Effective from date.' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ example: null, description: 'Effective to date, or null if indefinite.' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional({ example: true, description: 'Whether the policy is active.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
