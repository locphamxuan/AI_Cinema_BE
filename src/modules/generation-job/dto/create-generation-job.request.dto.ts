import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';
import { GenerationJobType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGenerationJobRequestDto {
  @ApiProperty({ example: 'f9e8d7c6-b5a4-3210-fedc-ba9876543210', description: 'UUID of the used AI model.' })
  @IsUUID()
  aiModelId: string;

  @ApiProperty({ example: 'SCRIPT', description: 'Pipeline stage the job belongs to.', enum: GenerationJobType })
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
