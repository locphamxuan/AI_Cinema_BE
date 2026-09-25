import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DraftSceneDto {
  @ApiPropertyOptional({ description: 'Id of an existing scene of the plan; absent for a new scene.' })
  @IsUUID()
  @IsOptional()
  id?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  sceneNumber: number;

  @ApiProperty({ example: 'Rượt đuổi trên mái nhà' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'Lâm đuổi theo drone của Aura qua các mái nhà ướt mưa.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 45 })
  @IsInt()
  @Min(1)
  targetDurationSeconds: number;

  @ApiPropertyOptional({ example: 60 })
  @IsInt()
  @Min(0)
  @IsOptional()
  estimatedTokens?: number;
}

/** The whole plan as the Creator left it: saved in one request, without sending it for review. */
export class SavePlanDraftRequestDto {
  @ApiPropertyOptional({ description: "This episode's script." })
  @IsString()
  @IsOptional()
  scriptText?: string;

  @ApiPropertyOptional({ example: 1800, description: 'Proposed episode duration (seconds).' })
  @IsInt()
  @Min(1)
  @IsOptional()
  targetDurationSeconds?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedAiResourceUsage?: number;

  @ApiProperty({
    type: [DraftSceneDto],
    description: 'Every scene of the plan, in order; scenes left out are deleted.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftSceneDto)
  scenes: DraftSceneDto[];
}
