import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGenreStyleModelRequestDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description:
      'UUID of the Genre this LoRA style adapter is scoped to. One genre can have several versions/base models.',
  })
  @IsUUID()
  genreId: string;

  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description:
      'UUID of the open-weight AiModel to train the LoRA on top of (e.g. FLUX). Must have modality IMAGE or VIDEO — closed third-party APIs cannot be fine-tuned.',
  })
  @IsUUID()
  baseAiModelId: string;

  @ApiProperty({
    example: 'Cyberpunk Neon Look v1',
    description: 'Human-readable label for this style adapter.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: 'ai-cinema-cyberpunk-v1',
    description:
      'Activation token embedded in generation prompts to trigger this LoRA. Lowercase letters, digits and hyphens only.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'triggerKeyword must contain only lowercase letters, digits and hyphens',
  })
  triggerKeyword: string;

  @ApiPropertyOptional({
    example: 'fal.ai',
    description: 'Hosted LoRA-training service used instead of self-managed GPU infra (Level 1 Orchestrator posture).',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  trainingProvider?: string;

  @ApiPropertyOptional({
    example: 15,
    description: 'Minimum number of training samples required before training can start. Defaults to 15.',
    default: 15,
  })
  @IsInt()
  @Min(5)
  @Max(200)
  @IsOptional()
  minSampleThreshold?: number;

  @ApiProperty({
    example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    description: 'UUID of the Content Reviewer who owns this genre-level style decision.',
  })
  @IsUUID()
  createdById: string;
}
