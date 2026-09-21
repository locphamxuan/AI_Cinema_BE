import {
  IsArray,
  IsDateString,
  IsEnum,
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
import { Type } from 'class-transformer';
import { ProductionContentType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProjectMilestoneRequestDto } from './create-project-milestone.request.dto';

export class CreateProductionProjectRequestDto {
  @ApiProperty({
    example: 'AI Cinema Project',
    description: 'Name of the production project. Used to identify the project across the platform.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    example: 'A sci-fi AI-generated movie series about time travel.',
    description: 'Brief overview of the movie concept, storyline, and creative vision for the project.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 'SERIES',
    description: 'Type of content to produce. Determines episode structure and publishing behaviour.',
    enum: ProductionContentType,
  })
  @IsEnum(ProductionContentType)
  contentType: ProductionContentType;

  @ApiPropertyOptional({
    example: 1800,
    description:
      'Default duration (seconds) of an episode/film of this project. The sum of all scene durations of a plan must not exceed this value.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  defaultEpisodeDurationSeconds?: number;

  @ApiProperty({
    example: 5,
    description:
      'Number of episodes this project will produce. Required for contentType SERIES; defaults to 1 for MOVIE. One DRAFT production plan is auto-created per episode (episodeNumber 1..N, planVersion 1) and assigned to the content creator, who can edit or revise them via the production-plan APIs.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  episodeCount?: number;

  @ApiProperty({
    example: '2026-10-01T00:00:00.000Z',
    description: 'ISO-8601 date when production starts. Must be before the deadline.',
  })
  @IsDateString()
  productionStartDate: string;

  @ApiProperty({
    example: '2026-12-31T23:59:59.000Z',
    description: 'ISO-8601 deadline by which all episodes must complete production and pass compliance review.',
  })
  @IsDateString()
  deadline: string;

  @ApiProperty({
    example: '2027-01-15T00:00:00.000Z',
    description: 'ISO-8601 date when the first episode is planned to be published on the platform.',
  })
  @IsDateString()
  plannedReleaseDate: string;

  @ApiProperty({
    example: 10000,
    description:
      'Total AI generation quota allocated to this project in resource units. Production plans consume from this budget.',
  })
  @IsNumber()
  @Min(0)
  totalAiQuotaBudget: number;

  @ApiPropertyOptional({
    example: ['b1c2d3e4-f5a6-7890-bcde-f12345678901'],
    description: 'Genres of the movie/series, selected by the Content Reviewer at project creation.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  genreIds?: string[];

  @ApiPropertyOptional({
    example: ['c2d3e4f5-a6b7-8901-cdef-123456789012'],
    description:
      'Policies this project is applying (e.g. AI labeling policy referencing Điều 44 Luật 134/2025/QH15 and Điều 18 NĐ 142/2026/NĐ-CP).',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  policyIds?: string[];

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Creator assigned to execute this production project.',
  })
  @IsNotEmpty()
  @IsUUID()
  assignedCreatorId: string;

  // @ApiProperty({
  //   example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  //   description: 'UUID of the Content Reviewer who creates and owns this production project.',
  // })
  // @IsUUID()
  // createdById: string;

  @ApiPropertyOptional({
    example: [
      {
        title: 'Script hoàn thành',
        description: 'Hoàn thiện kịch bản.',
        startDate: '2026-10-01T00:00:00.000Z',
        targetDate: '2026-11-01T00:00:00.000Z',
      },
    ],
    description: 'Initial milestones (production stages) of the project, created together with the project.',
    type: [CreateProjectMilestoneRequestDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProjectMilestoneRequestDto)
  @IsOptional()
  milestones?: CreateProjectMilestoneRequestDto[];
}
