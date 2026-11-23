import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PolicyType } from '@prisma/client';
import { BlankAsNull, Trim } from 'src/common/validation/trim';

export const POLICY_CONTENT_MAX = 20000;

export class CreatePolicyDto {
  @ApiProperty({ example: 'Quy định gắn nhãn nội dung do AI tạo', description: 'Title the Reviewer sees.' })
  @Trim()
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({
    example: PolicyType.AI_LABELING,
    enum: PolicyType,
    description:
      'AI_LABELING = AI label and the "has an AI label" item; CONTENT_POLICY = content safety item; LEGAL = Decree 142 notice and real-person/event items.',
  })
  @IsEnum(PolicyType)
  type: PolicyType;

  @ApiProperty({ example: '1.0.0' })
  @Trim()
  @IsString()
  @Length(1, 50)
  version: string;

  @ApiPropertyOptional({ example: 'Điều 44 Luật số 134/2025/QH15', nullable: true })
  @IsOptional()
  @BlankAsNull()
  @IsString()
  @MaxLength(1000)
  documentReference?: string | null;

  @ApiProperty({
    example: 'Mọi tập có phần do AI tạo phải gắn nhãn.\n- Nhãn hiện trên màn hình ở mọi tập.',
    description: 'Plain text; line breaks and "- " bullets are kept.',
  })
  @Trim()
  @IsString()
  @Length(1, POLICY_CONTENT_MAX)
  content: string;

  @ApiPropertyOptional({ example: '2026-05-01T00:00:00.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, description: 'Null = no end date.' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
