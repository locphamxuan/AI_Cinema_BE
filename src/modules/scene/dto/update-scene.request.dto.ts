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
}
