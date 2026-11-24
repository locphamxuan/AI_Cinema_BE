import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IfSent } from 'src/common/validation/if-sent';
import { Trim } from 'src/common/validation/trim';
import { IsCalendarDay } from './calendar-day';
import { MAX_TARGET_DURATION_SECONDS } from './create-movie-project.request.dto';

export class AssignCreatorRequestDto {
  @ApiProperty({ description: 'Active Content Creator account that will run the project.' })
  @IsUUID('4')
  creatorId: string;
}

export class ReasonRequestDto {
  @ApiProperty({ example: 'The studio closed down and no replacement fits the budget.' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}

/** Only the fields sent change; title, length and deadline cannot be cleared (null is refused). */
export class UpdateEpisodeRequestDto {
  @ApiPropertyOptional()
  @IfSent()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string | null;

  @ApiPropertyOptional({ description: 'Can change until the episode is approved (BR-31).' })
  @IfSent()
  @IsInt()
  @Min(1)
  @Max(MAX_TARGET_DURATION_SECONDS)
  targetDurationSeconds?: number;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Moves the delivery deadline (and the studio due date once handed off); not into the past.',
  })
  @IfSent()
  @IsCalendarDay()
  deliveryDeadline?: string;

  @ApiPropertyOptional({
    example: '2026-12-10',
    nullable: true,
    description: "Expected release day within the season's window, not before the deadline; null clears it.",
  })
  @IsCalendarDay()
  @IsOptional()
  expectedReleaseDate?: string | null;
}

export class UpdateSeasonRequestDto {
  @ApiPropertyOptional({ example: 'Mùa 1', nullable: true })
  @Trim()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string | null;

  @ApiPropertyOptional({ example: '2026-12-01', nullable: true, description: 'null clears it (BR-60).' })
  @IsCalendarDay()
  @IsOptional()
  releaseStartDate?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31', nullable: true, description: 'null clears it (BR-60).' })
  @IsCalendarDay()
  @IsOptional()
  releaseEndDate?: string | null;
}
