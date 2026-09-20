import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCatalogEpisodeRequestDto {
  @ApiPropertyOptional({ example: 'Hành trình AI - Tập 2 (Bản mới)', description: 'New title of the catalog episode.' })
  @IsString()
  @IsOptional()
  title?: string;
}