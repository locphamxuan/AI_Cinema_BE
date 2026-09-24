import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';
import { GenerationJobType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGenerationJobRequestDto {
  @ApiProperty({
    example: 'SCRIPT',
    description: 'Pipeline stage the job belongs to. The AI model is picked by the system from this (BR-40).',
    enum: GenerationJobType,
  })
  @IsEnum(GenerationJobType)
  jobType: GenerationJobType;

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
