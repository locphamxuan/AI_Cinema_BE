import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSceneRequestDto {
  @ApiProperty({ example: 1, description: 'Scene number, unique within its production plan. Must be >= 1.' })
  @IsInt()
  @Min(1)
  sceneNumber: number;

  @ApiProperty({ example: 'Mở đầu', description: 'Title of the scene.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    example: 'Captain Lee stares at the countdown timer...',
    description: 'Script segment of the scene.',
  })
  @IsString()
  @IsOptional()
  scriptText?: string;

  @ApiProperty({
    example: 120,
    description: 'Target duration (seconds) of the scene. Sum of all scenes must fit the episode duration.',
  })
  @IsInt()
  @Min(1)
  targetDurationSeconds: number;
}
