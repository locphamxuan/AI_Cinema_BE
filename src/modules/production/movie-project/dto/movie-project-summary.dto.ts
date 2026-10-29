import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';

/** One row of the project list. */
export class MovieProjectSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Căn Hộ Số 13' })
  title: string;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;

  @ApiPropertyOptional({ example: { id: '8c1b2f3e-…', name: 'Studio Ánh Trăng' }, nullable: true })
  studio: { id: string; name: string } | null;

  @ApiProperty()
  reviewerId: string;

  @ApiPropertyOptional()
  creatorId: string | null;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ description: 'Newest change of the project: its latest content event, else its own update time.' })
  lastActivityAt: Date;
}
