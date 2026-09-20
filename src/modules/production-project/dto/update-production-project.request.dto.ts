import { IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProductionProjectRequestDto {
  @ApiPropertyOptional({
    example: 'AI Cinema Project (Season 1)',
    description: 'Name of the production project.',
  })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Brief overview of the movie concept.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 1800,
    description:
      'Default duration (seconds) of an episode/film. Cannot be lowered below the current total scene duration of any plan.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  defaultEpisodeDurationSeconds?: number;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z', description: 'Production deadline (ISO-8601).' })
  @IsDateString()
  @IsOptional()
  deadline?: string;

  @ApiPropertyOptional({ example: '2027-01-15T00:00:00.000Z', description: 'Planned release date (ISO-8601).' })
  @IsDateString()
  @IsOptional()
  plannedReleaseDate?: string;

  @ApiPropertyOptional({
    example: 15000,
    description: 'Total AI generation quota. Only the total can be increased/decreased following the budget rules.',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalAiQuotaBudget?: number;

  @ApiPropertyOptional({
    example: ['b1c2d3e4-f5a6-7890-bcde-f12345678901'],
    description: 'Full replacement list of genre ids applied to the project.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  genreIds?: string[];

  @ApiPropertyOptional({
    example: ['c2d3e4f5-a6b7-8901-cdef-123456789012'],
    description: 'Full replacement list of policy ids applied to the project.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  policyIds?: string[];
}
