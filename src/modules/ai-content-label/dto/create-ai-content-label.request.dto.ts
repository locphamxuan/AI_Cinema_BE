import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { LabelType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAiContentLabelRequestDto {
  @ApiProperty({ example: 'AI_GENERATED', description: 'Type of the AI-content label.', enum: LabelType })
  @IsEnum(LabelType)
  labelType: LabelType;

  @ApiProperty({ example: 'Nội dung được tạo bởi AI', description: 'Label text displayed to the audience.' })
  @IsString()
  labelText: string;

  @ApiPropertyOptional({ example: 'OPENING_CREDITS', description: 'Where in the UI the label is displayed.' })
  @IsString()
  @IsOptional()
  displayLocation?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'UUID of the user applying the label.' })
  @IsUUID()
  @IsOptional()
  appliedById?: string;

  @ApiProperty({ example: 'c4e5d6f7-a8b9-0123-cdef-456789abcdef', description: 'UUID of the Policy the label must comply with.' })
  @IsUUID()
  policyId: string;
}