import { IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateSceneRequestDto } from 'src/modules/scene/dto/create-scene.request.dto';

export class CreateProductionPlanRequestDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Episode number this plan covers within the production project. Must be >= 1.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  episodeNumber?: number;

  @ApiPropertyOptional({
    example: 'b1c2d3e4-f5a6-7890-bcde-f12345678901',
    description: 'UUID of a previous production plan revision. When set, this plan supersedes the referenced plan.',
  })
  @IsUUID()
  @IsOptional()
  previousPlanId?: string;

  @ApiPropertyOptional({
    example:
      'INT. CONTROL ROOM - DAY\n\nCaptain Lee stares at the countdown timer. The crew scrambles to override the launch sequence...',
    description: 'Full script text for the episode. Supports plain text or light markdown formatting.',
  })
  @IsString()
  @IsOptional()
  scriptText?: string;

  @ApiPropertyOptional({
    example: 'Full AI generation with 3D character animation and voice-over',
    description: 'High-level description of the production approach, tools, and techniques planned for this episode.',
  })
  @IsString()
  @IsOptional()
  productionApproach?: string;

  @ApiPropertyOptional({
    example: 1800,
    description:
      'Target episode duration in seconds. If set, must not exceed the project default episode duration; the sum of scene durations must fit under it.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  targetDurationSeconds?: number;

  @ApiPropertyOptional({
    example: ['vi', 'en'],
    description: 'List of BCP-47 language codes indicating which localised versions will be produced.',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetLanguages?: string[];

  @ApiPropertyOptional({
    example: 500,
    description:
      'Estimated AI generation quota this plan will consume. Deducted from the project budget upon approval.',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedAiResourceUsage?: number;

  @ApiPropertyOptional({
    example: [
      { sceneNumber: 1, title: 'Opening', targetDurationSeconds: 120 },
      { sceneNumber: 2, title: 'Climax', targetDurationSeconds: 300 },
    ],
    description:
      'Initial scenes of the plan. Optional - a plan can be created first and scenes added later via POST /production-plans/:planId/scenes.',
    type: [CreateSceneRequestDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSceneRequestDto)
  @IsOptional()
  scenes?: CreateSceneRequestDto[];

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Creator who authors this production plan.',
  })
  @IsUUID()
  createdById: string;
}
