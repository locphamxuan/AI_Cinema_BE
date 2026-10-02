import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MovieStatus } from '@prisma/client';

/** One row of the project list. */
export class MovieProjectSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Căn Hộ Số 13' })
  title: string;

  @ApiProperty({ enum: MovieStatus })
  status: MovieStatus;

  @ApiPropertyOptional({ example: 'Studio Ánh Trăng' })
  studioName: string | null;

  @ApiProperty()
  reviewerId: string;

  @ApiPropertyOptional()
  creatorId: string | null;

  @ApiProperty()
  updatedAt: Date;
}
