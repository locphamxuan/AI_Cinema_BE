import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCatalogRequestDto {
  @ApiProperty({ example: 'Hành trình AI', description: 'Title of the catalog movie/series.' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'vi', description: 'Default BCP-47 language code.' })
  @IsString()
  defaultLanguage: string;

  @ApiPropertyOptional({ example: 'Bộ phim hoạt hình do AI tạo.', description: 'Movie synopsis.' })
  @IsString()
  @IsOptional()
  synopsis?: string;

  @ApiPropertyOptional({ example: 'Chi tiết về phim.', description: 'Movie description.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Season number of the episode. Defaults to no season (standalone movie episode). Creates the season if it does not exist.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  seasonNumber?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Episode number within the movie/season. Defaults to the plan episode number.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  episodeNumber?: number;

  @ApiPropertyOptional({
    example: 'Hành trình AI - Tập 2',
    description: 'Episode title. Defaults to "{movie title} - Tập {episodeNumber}".',
  })
  @IsString()
  @IsOptional()
  episodeTitle?: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'UUID of the user that creates the catalog entry.' })
  @IsUUID()
  createdById: string;
}