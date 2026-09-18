import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateProductionProjectRequestDto {
  @ApiPropertyOptional({
    example: 'AI Cinema Project',
    description: 'New title of the production project. Must be non-empty and at most 255 characters.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated concept for the sci-fi AI-generated movie series.',
    description: 'New overview of the movie concept and production requirements.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description: 'New ISO-8601 deadline by which all episodes must complete production and pass compliance review.',
  })
  @IsDateString()
  @IsOptional()
  deadline?: string;

  @ApiPropertyOptional({
    example: '2027-01-15T00:00:00.000Z',
    description: 'New ISO-8601 planned release date. Must be on or after the deadline.',
  })
  @IsDateString()
  @IsOptional()
  plannedReleaseDate?: string;

  @ApiPropertyOptional({
    example: 12000,
    description:
      'New total AI generation quota in resource units. Increasing it also increases the remaining budget by the same amount; it cannot be lowered below the quota already allocated to production plans.',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalAiQuotaBudget?: number;
}
