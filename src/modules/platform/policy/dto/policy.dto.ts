import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PolicyType } from '@prisma/client';

export class PolicyDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the policy.',
  })
  id: string;

  @ApiProperty({
    example: 'Quy định gắn nhãn nội dung do AI tạo',
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

  @ApiProperty({
    example: 'Mọi tập có phần do AI tạo phải gắn nhãn.\n- Nhãn hiện trên màn hình ở mọi tập.',
    description: 'Plain text the Reviewer reads; line breaks and "- " bullets are kept.',
  })
  content: string;

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

  @ApiProperty({ example: '2026-11-22T00:00:00.000Z', description: 'Date when the policy was last changed.' })
  updatedAt: Date;
}
