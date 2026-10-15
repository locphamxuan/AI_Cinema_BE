import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowered = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

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

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  @Max(1000)
  episodeCount: number;
}
