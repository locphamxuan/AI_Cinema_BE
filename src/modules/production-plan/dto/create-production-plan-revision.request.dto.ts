import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductionPlanRevisionRequestDto {
  @ApiPropertyOptional({ description: 'Overrides the script text of the previous plan.' })
  @IsString()
  @IsOptional()
  scriptText?: string;

  @ApiPropertyOptional({ description: 'Overrides the production approach of the previous plan.' })
  @IsString()
  @IsOptional()
  productionApproach?: string;

  @ApiPropertyOptional({ example: 1800, description: 'Overrides the target episode duration (seconds).' })
  @IsInt()
  @Min(1)
  @IsOptional()
  targetDurationSeconds?: number;

  @ApiPropertyOptional({ example: ['vi', 'en'], description: 'Overrides the list of target languages.' })
  @IsString({ each: true })
  @IsOptional()
  targetLanguages?: string[];

  @ApiPropertyOptional({ example: 600, description: 'Overrides the estimated AI generation quota.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedAiResourceUsage?: number;
}
