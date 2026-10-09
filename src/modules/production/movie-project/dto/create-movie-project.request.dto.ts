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
    description: 'Day the episode must be done; the studio due date the Creator sets cannot be later.',
  })
  @IsDateString({ strict: true })
  milestoneDate: string;

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

  @ApiProperty({ type: [NewSeasonDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NewSeasonDto)
  seasons: NewSeasonDto[];
}
