import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductionPlanRevisionRequestDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Creator who authors the revised production plan.',
  })
  @IsUUID()
  createdById: string;

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
