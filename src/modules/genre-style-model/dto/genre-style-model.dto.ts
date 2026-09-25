import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GenreStyleModelStatus } from '@prisma/client';

export class GenreStyleModelDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  genreId: string;

  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  baseAiModelId: string;

  @ApiProperty({ example: 'Cyberpunk Neon Look v1' })
  name: string;

  @ApiProperty({ example: 'ai-cinema-cyberpunk-v1' })
  triggerKeyword: string;

  @ApiProperty({ enum: GenreStyleModelStatus, example: GenreStyleModelStatus.DRAFT })
  status: GenreStyleModelStatus;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiPropertyOptional({ example: 'fal.ai' })
  trainingProvider?: string | null;

  @ApiPropertyOptional({ example: 'genre-style-weights/cyberpunk-v1.safetensors' })
  storageKey?: string | null;

  @ApiProperty({ example: 18 })
  sampleCount: number;

  @ApiProperty({ example: 15 })
  minSampleThreshold: number;

  @ApiProperty({ example: false })
  isActive: boolean;

  @ApiPropertyOptional({ example: null })
  failureReason?: string | null;

  @ApiPropertyOptional({ example: null })
  trainedAt?: Date | null;

  @ApiProperty({ example: '2026-09-20T07:00:00.000Z' })
  createdAt: Date;
}
