import { ApiProperty } from '@nestjs/swagger';

/** One row of the member's watch history, newest first. */
export class HistoryItemDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;

  @ApiProperty({ example: 'Tập 5: Thành phố Neon' })
  episodeTitle: string;

  @ApiProperty({ example: 5 })
  episodeNumber: number;

  @ApiProperty({ example: null, nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ example: '3a71f0d4-9c22-4c6b-8f31-1a2b3c4d5e6f' })
  movieId: string;

  @ApiProperty({ example: 'Sài Gòn 2046' })
  movieTitle: string;

  @ApiProperty({ example: 320 })
  positionSeconds: number;

  @ApiProperty({ example: 1320, nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ example: false })
  completed: boolean;

  @ApiProperty({ example: '2026-10-15T10:00:00.000Z', nullable: true })
  lastWatchedAt: Date | null;
}
