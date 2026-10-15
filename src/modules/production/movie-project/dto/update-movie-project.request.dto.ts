import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
} from 'class-validator';
import { LANGUAGE_CODE } from 'src/common/validation/language-code';
import { Trim } from 'src/common/validation/trim';

/** Viewer age rating of the movie; also what an under-age account is checked against. */
export const AGE_RATINGS = ['T16', 'T18'] as const;

/** Only the fields sent are changed. */
export class UpdateMovieProjectRequestDto {
  @ApiPropertyOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @Trim()
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  @IsOptional()
  ideaDescription?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  genreIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'A genre name the table lacks is added on the spot.' })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  genreNames?: string[];

  @ApiPropertyOptional({ example: 'vi' })
  @Matches(LANGUAGE_CODE)
  @IsOptional()
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'Catalog synopsis, required before the first episode is published.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;

  @ApiPropertyOptional({ enum: AGE_RATINGS, description: 'Required before the first episode is published.' })
  @IsIn(AGE_RATINGS)
  @IsOptional()
  ageRating?: (typeof AGE_RATINGS)[number];

  @ApiPropertyOptional({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  releaseYear?: number;

  @ApiPropertyOptional({ description: 'Active studio from the catalog; only before the hand-off (BR-59).' })
  @IsUUID('4')
  @IsOptional()
  studioId?: string;
}
