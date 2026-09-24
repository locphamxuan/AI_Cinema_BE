import { IsEnum, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { GenerationJobType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LANGUAGE_CODE } from 'src/common/validation/language-code';

export class CreateGenerationJobRequestDto {
  @ApiProperty({
    example: 'SCRIPT',
    description: 'Pipeline stage the job belongs to. The AI model is picked by the system from this (BR-40).',
    enum: GenerationJobType,
  })
  @IsEnum(GenerationJobType)
  jobType: GenerationJobType;

  @ApiPropertyOptional({
    example: 'phong cách kịch tính hồi hộp, mưa đêm',
    description:
      'Free-form Creator prompt. Required except for VIDEO_ASSEMBLY; the Prompt Composer expands it with the scene context before it reaches the model.',
  })
  @IsString()
  @MaxLength(4000)
  @IsOptional()
  prompt?: string;

  @ApiPropertyOptional({
    example: 'đồng bộ khẩu hình nhân vật',
    description: 'Required when jobType is CUSTOM: what the Creator wants the function to do.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  customFunction?: string;

  @ApiPropertyOptional({
    example: 'en',
    description: 'Required when jobType is SUBTITLE or TRANSLATION: BCP-47 code of the output language.',
  })
  @Matches(LANGUAGE_CODE, { message: 'language must be a BCP-47 code such as "vi" or "en"' })
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ description: 'UUID of the scene this job produces assets for (scene-level job).' })
  @IsUUID()
  @IsOptional()
  sceneId?: string;

  @ApiPropertyOptional({ description: 'Parent job id when this is a retry of a failed job.' })
  @IsUUID()
  @IsOptional()
  parentJobId?: string;

  @ApiPropertyOptional({ description: 'Free-form config snapshot handed to the AI provider.' })
  @IsObject()
  @IsOptional()
  configSnapshot?: Record<string, unknown>;
}
