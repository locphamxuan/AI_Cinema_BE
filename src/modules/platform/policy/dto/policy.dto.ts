import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PolicyType } from '@prisma/client';

export class PolicyDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the policy.',
  })
  id: string;

  @ApiProperty({
    example: 'AI-Generated Content Labeling Policy',
    description: 'Name of the policy.',
  })
  name: string;

  @ApiProperty({
    example: 'AI_LABELING',
    description: 'Category of the policy.',
    enum: PolicyType,
  })
  type: PolicyType;

  @ApiProperty({
    example: '1.0.0',
    description: 'Version of the policy.',
  })
  version: string;

  @ApiPropertyOptional({
    example: 'Điều 44 Luật số 134/2025/QH15 và Điều 18 Nghị định số 142/2026/NĐ-CP',
    description: 'Legal document reference of the policy.',
  })
  documentReference?: string;

  @ApiPropertyOptional({
    description: 'Structured content and requirements of the policy.',
    type: Object,
  })
  content?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '2026-05-01T00:00:00.000Z',
    description: 'Date from which the policy takes effect.',
  })
  effectiveFrom?: Date;

  @ApiPropertyOptional({
    example: null,
    description: 'Date until which the policy is valid, or null if it is indefinitely effective.',
  })
  effectiveTo?: Date;

  @ApiProperty({
    example: true,
    description: 'Whether the policy is currently active.',
  })
  isActive: boolean;

  @ApiProperty({
    example: '2026-09-18T00:00:00.000Z',
    description: 'Date when the policy was created.',
  })
  createdAt: Date;
}
