import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LANGUAGE_CODE } from 'src/common/validation/language-code';
import { AGE_RATINGS } from './update-movie-project.request.dto';

import { Trim } from 'src/common/validation/trim';

/** BR-31: any length the Reviewer wants; the bound only catches typos (12 h). */
export const MAX_TARGET_DURATION_SECONDS = 12 * 60 * 60;

/** Token for one episode; the bound only catches typos. */
export const MAX_EPISODE_PRODUCTION_COST = 100_000_000;

export class NewEpisodeDto {
  @ApiProperty({ example: 'Tập 1: Tiếng gõ cửa lúc nửa đêm' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 900, description: 'Target length in seconds, chosen by the Reviewer (BR-31).' })
  @IsInt()
  @Min(1)
  @Max(MAX_TARGET_DURATION_SECONDS)
  targetDurationSeconds: number;

  @ApiProperty({
    example: '2026-11-30',
    description: 'Day the studio must deliver the episode (BR-38); the studio due date cannot be later.',
  })
  @IsDateString({ strict: true })
  deliveryDeadline: string;

  @ApiPropertyOptional({
    example: '2026-12-10',
    description: "Expected release day: within the season's release window, not before the deadline (BR-60).",
  })
  @IsDateString({ strict: true })
  @IsOptional()
  expectedReleaseDate?: string;

  @ApiPropertyOptional({ example: 'Một cô gái nhận được cuộc gọi lạ…' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;
}

export class NewSeasonDto {
  @ApiPropertyOptional({ example: 'Mùa 1' })
  @Trim()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiProperty({
    example: 5000,
    description: 'Token the studio is paid for one episode of this season (BR-37); the season fee is price × episodes.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_EPISODE_PRODUCTION_COST)
  episodeProductionCost: number;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'First day of the release window (BR-60).' })
  @IsDateString({ strict: true })
  @IsOptional()
  releaseStartDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Last day of the release window (BR-60).' })
  @IsDateString({ strict: true })
  @IsOptional()
  releaseEndDate?: string;

  @ApiProperty({ type: [NewEpisodeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NewEpisodeDto)
  episodes: NewEpisodeDto[];
}

/** Step 1 of MF-1: the Reviewer sets up the project and its season/episode structure (BR-12, BR-37). */
export class CreateMovieProjectRequestDto {
  @ApiProperty({ example: 'Căn Hộ Số 13' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Phim kinh dị tâm lý về một căn hộ…', description: 'Story, style and audience.' })
  @Trim()
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  ideaDescription: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['8c1b2f3e-…'],
    description: 'Existing genres; with genreNames, 1–5 in all.',
  })
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  genreIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Hậu tận thế'],
    description: 'Genre names; one the list does not have yet is added to the genres table on the spot.',
  })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  genreNames?: string[];

  @ApiPropertyOptional({ description: 'Catalog synopsis for viewers; the Reviewer may also attach files to it.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;

  @ApiPropertyOptional({ enum: AGE_RATINGS, description: 'Viewer age rating; required before the first release.' })
  @IsIn(AGE_RATINGS)
  @IsOptional()
  ageRating?: (typeof AGE_RATINGS)[number];

  @ApiPropertyOptional({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  releaseYear?: number;

  @ApiPropertyOptional({ example: 'vi', default: 'vi' })
  @Matches(LANGUAGE_CODE)
  @IsOptional()
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'Active studio from the catalog (BR-59); the Creator may pick it at hand-off.' })
  @IsUUID('4')
  @IsOptional()
  studioId?: string;

  @ApiProperty({ type: [NewSeasonDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NewSeasonDto)
  seasons: NewSeasonDto[];
}
