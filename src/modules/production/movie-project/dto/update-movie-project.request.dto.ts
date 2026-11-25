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
import { IfSent } from 'src/common/validation/if-sent';
import { Trim } from 'src/common/validation/trim';
import { TrimEach } from './calendar-day';

/** Viewer age rating of the movie; also what an under-age account is checked against. */
export const AGE_RATINGS = ['T16', 'T18'] as const;

/** Only the fields sent are changed; title, idea, genres, language and studio cannot be cleared (null is refused). */
export class UpdateMovieProjectRequestDto {
  @ApiPropertyOptional()
  @IfSent()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IfSent()
  @Trim()
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  ideaDescription?: string;

  @ApiPropertyOptional({ type: [String] })
  @IfSent()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  genreIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'A genre name the table lacks is added on the spot.' })
  @IfSent()
  @TrimEach()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  genreNames?: string[];

  @ApiPropertyOptional({ example: 'vi' })
  @IfSent()
  @Matches(LANGUAGE_CODE)
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
  @IfSent()
  @IsUUID('4')
  studioId?: string;
}
