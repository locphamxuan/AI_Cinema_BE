import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionContentType, ProductionProjectStatus } from '@prisma/client';

export class ProductionProjectDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the production project.',
  })
  id: string;

  @ApiProperty({
    example: 'AI Cinema Project',
    description: 'Name of the production project.',
  })
  title: string;

  @ApiPropertyOptional({
    example: 'A sci-fi AI-generated movie series about time travel.',
    description: 'Overview of the movie concept and production requirements.',
  })
  description?: string;

  @ApiProperty({
    example: 'MOVIE',
    description: 'Type of content to produce.',
    enum: ProductionContentType,
  })
  contentType: ProductionContentType;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Reviewer who created the project.',
  })
  createdById: string;

  @ApiProperty({
    example: '2026-12-31T23:59:59.000Z',
    description: 'Deadline by which all episodes must complete production.',
  })
  deadline: Date;

  @ApiProperty({
    example: '2027-01-15T00:00:00.000Z',
    description: 'Date when the first episode is planned to be published.',
  })
  plannedReleaseDate: Date;

  @ApiProperty({
    example: 10000,
    description: 'Total AI generation quota allocated to this project.',
  })
  totalAiQuotaBudget: number;

  @ApiProperty({
    example: 10000,
    description: 'Remaining AI generation quota available for allocation.',
  })
  remainingAiQuotaBudget: number;

  @ApiProperty({
    example: 'DRAFT',
    description: 'Project lifecycle status.',
    enum: ProductionProjectStatus,
  })
  status: ProductionProjectStatus;
}
