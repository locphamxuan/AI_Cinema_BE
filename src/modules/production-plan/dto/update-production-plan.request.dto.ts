import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProductionPlanRequestDto {
  @ApiPropertyOptional({ description: 'Full script text for the episode.' })
  @IsString()
  @IsOptional()
  scriptText?: string;

  @ApiPropertyOptional({ description: 'High-level description of the production approach.' })
  @IsString()
  @IsOptional()
  productionApproach?: string;

  @ApiPropertyOptional({
    example: 1800,
    description: 'Target episode duration (seconds). Lowering it below the current sum of scene durations is rejected.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  targetDurationSeconds?: number;

  @ApiPropertyOptional({ example: ['vi', 'en'], description: 'List of BCP-47 language codes.' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetLanguages?: string[];

  @ApiPropertyOptional({ example: 500, description: 'Estimated AI generation quota.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedAiResourceUsage?: number;
}
