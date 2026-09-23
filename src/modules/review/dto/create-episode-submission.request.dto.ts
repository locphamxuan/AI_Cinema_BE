import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEpisodeSubmissionRequestDto {
  @ApiPropertyOptional({ example: 'Toàn bộ phân cảnh đã hoàn thành', description: 'Optional note for the submission.' })
  @IsString()
  @IsOptional()
  note?: string;
}
