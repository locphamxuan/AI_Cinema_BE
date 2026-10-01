import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
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

export const AGE_RATINGS = ['T16', 'T18'] as const;

/** Only the fields sent are changed. */
export class UpdateMovieProjectRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  @IsOptional()
  ideaDescription?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  genreIds?: string[];

  @ApiPropertyOptional({ example: 'vi' })
  @Matches(LANGUAGE_CODE)
  @IsOptional()
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'Catalog synopsis, required before the first episode is published.' })
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;

  @ApiPropertyOptional({ enum: AGE_RATINGS, description: 'Required before the first episode is published (BR-54).' })
  @IsIn(AGE_RATINGS)
  @IsOptional()
  ageRating?: (typeof AGE_RATINGS)[number];

  @ApiPropertyOptional({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  releaseYear?: number;
}
