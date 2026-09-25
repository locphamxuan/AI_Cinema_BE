import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCatalogRequestDto {
  @ApiPropertyOptional({
    example: 'Hành trình AI',
    description:
      "Title of the catalog movie/series. Defaults to the project title; ignored once the project's movie exists.",
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'vi', description: 'Default BCP-47 language code. Defaults to "vi".' })
  @IsString()
  @IsOptional()
  defaultLanguage?: string;

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
      "Season number of the episode. Defaults to the plan's season for a SERIES and no season for a MOVIE. Creates the season if it does not exist.",
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  seasonNumber?: number;

  @ApiPropertyOptional({
    example: 2,
    description: "Episode number within the season. Defaults to the plan's number inside its season.",
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
}
