import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ProductionContentType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductionProjectRequestDto {
  @ApiProperty({
    example: 'AI Cinema Project',
    description: 'Name of the production project. Used to identify the project across the platform.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 'A sci-fi AI-generated movie series about time travel.',
    description: 'Brief overview of the movie concept, storyline, and creative vision for the project.',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 'MOVIE',
    description: 'Type of content to produce. Determines episode structure and publishing behaviour.',
    enum: ProductionContentType,
  })
  @IsEnum(ProductionContentType)
  contentType: ProductionContentType;

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

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Reviewer who creates and owns this production project.',
  })
  @IsUUID()
  createdById: string;
}
