import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
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

/** BR-31: any length the Reviewer wants; the bound only catches typos (12 h). */
export const MAX_TARGET_DURATION_SECONDS = 12 * 60 * 60;

/** Token for one episode; the bound only catches typos. */
export const MAX_EPISODE_PRODUCTION_COST = 100_000_000;

export class NewEpisodeDto {
  @ApiProperty({ example: 'Tập 1: Tiếng gõ cửa lúc nửa đêm' })
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
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;
}

export class NewSeasonDto {
  @ApiPropertyOptional({ example: 'Mùa 1' })
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
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Phim kinh dị tâm lý về một căn hộ…', description: 'Story, style and audience.' })
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  ideaDescription: string;

  @ApiProperty({ type: [String], example: ['8c1b2f3e-…'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  genreIds: string[];

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
