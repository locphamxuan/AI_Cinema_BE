import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSceneRequestDto {
  @ApiPropertyOptional({ example: 1, description: 'Scene number, unique within its production plan.' })
  @IsInt()
  @Min(1)
  @IsOptional()
  sceneNumber?: number;

  @ApiPropertyOptional({ example: 'Mở đầu (v2)', description: 'Title of the scene.' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Script segment of the scene.' })
  @IsString()
  @IsOptional()
  scriptText?: string;

  @ApiPropertyOptional({
    example: 90,
    description: 'Target duration (seconds). Re-validates the total duration against the episode limit.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  targetDurationSeconds?: number;

  @ApiPropertyOptional({
    example: 'Cảnh mở đầu: con hẻm ngập nước dưới ánh đèn neon.',
    description: 'What happens in the scene; context for the Prompt Composer.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 120,
    description: 'BR-38: Creator planning estimate of AI tokens for this scene (not a hard quota).',
    default: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  estimatedTokens?: number;
}
