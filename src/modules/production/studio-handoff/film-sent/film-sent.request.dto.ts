import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowered = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** One episode of the mail: where it sits in the order and the link the Creator downloads it from. */
export class FilmSentEpisodeDto {
  @ApiProperty({ example: 1, description: '1-based position in the order, as the brief lists the episodes.' })
  @IsInt()
  @Min(1)
  @Max(1000)
  episode: number;

  @ApiProperty({ example: 'tap-1.mp4' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'https://studio.example/films/7f1c/tap-1.mp4' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  url: string;
}

/** What the Studio Web tells AI Cinema once it has mailed a prepared film back to the Creator. */
export class FilmSentRequestDto {
  @ApiProperty({ example: 'contact@anhtrang.studio', description: 'The studio address the brief was mailed to.' })
  @Transform(lowered)
  @IsEmail()
  @MaxLength(255)
  studioEmail: string;

  @ApiProperty({ example: 'creator@aicinema.local', description: 'The contact named in the brief: the Creator.' })
  @Transform(lowered)
  @IsEmail()
  @MaxLength(255)
  creatorEmail: string;

  @ApiProperty({ example: 'Hành Trình Ánh Sáng' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  movieTitle: string;

  @ApiProperty({ example: 'Mùa 1', description: '"Toàn bộ dự án" or "Mùa N", as printed in the brief.' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  scope: string;

  @ApiProperty({ example: 'v2', description: "The studio's own name for this cut." })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  version: string;

  @ApiPropertyOptional({ example: 'Bản dựng cuối' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  @IsOptional()
  label?: string;

  @ApiProperty({ type: [FilmSentEpisodeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FilmSentEpisodeDto)
  episodes: FilmSentEpisodeDto[];
}
