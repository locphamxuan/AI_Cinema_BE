import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

/** Player heartbeat, every 10–15s: where it is and how much was watched since the last beat. */
export class HeartbeatRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  positionSeconds: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  watchedSeconds?: number;
}

/** Leaving the player: persist where the viewer stopped. */
export class StopSessionRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  positionSeconds: number;
}

/** Saved resume position of a member for an episode (flow 3, steps 8–10). */
export class ProgressViewDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;

  @ApiProperty({ example: true, description: 'False when the member never opened the episode' })
  found: boolean;

  @ApiProperty({ example: 320 })
  positionSeconds: number;

  @ApiProperty({ example: 1320, nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ example: false })
  completed: boolean;

  @ApiProperty({ example: null, nullable: true })
  completedAt: Date | null;

  @ApiProperty({ example: null, nullable: true })
  lastWatchedAt: Date | null;
}

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

/** Session state after a heartbeat, stop or completion (flow 3, steps 15/18–21). */
export class SessionStateViewDto {
  @ApiProperty({ example: 'b21c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  sessionId: string;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: 320 })
  positionSeconds: number;

  @ApiProperty({ example: 640, description: 'Accumulated watch time; feeds monthly revenue sharing' })
  totalWatchedSeconds: number;

  @ApiProperty({ example: false })
  completed: boolean;
}
