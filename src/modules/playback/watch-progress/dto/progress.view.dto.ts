import { ApiProperty } from '@nestjs/swagger';

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
