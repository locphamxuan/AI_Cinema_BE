import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_EPISODE_PRODUCTION_COST, MAX_TARGET_DURATION_SECONDS } from './create-movie-project.request.dto';

export class AssignCreatorRequestDto {
  @ApiProperty({ description: 'Active Content Creator account that will run the project.' })
  @IsUUID('4')
  creatorId: string;
}

export class ReasonRequestDto {
  @ApiProperty({ example: 'The studio closed down and no replacement fits the budget.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}

export class UpdateEpisodeRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;

  @ApiPropertyOptional({ description: 'Can change until the episode is approved (BR-31).' })
  @IsInt()
  @Min(1)
  @Max(MAX_TARGET_DURATION_SECONDS)
  @IsOptional()
  targetDurationSeconds?: number;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Moves the delivery deadline (and the studio due date once handed off); not into the past.',
  })
  @IsDateString({ strict: true })
  @IsOptional()
  deliveryDeadline?: string;

  @ApiPropertyOptional({
    example: '2026-12-10',
    nullable: true,
    description: "Expected release day within the season's window, not before the deadline; null clears it.",
  })
  @IsDateString({ strict: true })
  @IsOptional()
  expectedReleaseDate?: string | null;
}

export class UpdateSeasonRequestDto {
  @ApiPropertyOptional({ example: 'Mùa 1' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Token for one episode of the season; a rise after the allocation is paid with a "+… Token thêm".',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_EPISODE_PRODUCTION_COST)
  @IsOptional()
  episodeProductionCost?: number;

  @ApiPropertyOptional({ example: '2026-12-01', nullable: true, description: 'null clears it (BR-60).' })
  @IsDateString({ strict: true })
  @IsOptional()
  releaseStartDate?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31', nullable: true, description: 'null clears it (BR-60).' })
  @IsDateString({ strict: true })
  @IsOptional()
  releaseEndDate?: string | null;
}
