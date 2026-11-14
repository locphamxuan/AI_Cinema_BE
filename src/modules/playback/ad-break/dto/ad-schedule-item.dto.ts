import { ApiProperty } from '@nestjs/swagger';

/** One mid-roll cue of a session, with the ad the player shows when it gets there. */
export class AdScheduleItemDto {
  @ApiProperty({ example: 'c31d...' })
  breakId: string;

  @ApiProperty({ example: 600, description: 'Cue point in seconds from the episode start' })
  positionSeconds: number;

  @ApiProperty({ example: { id: 'a1...', title: 'Trà sữa', mediaUrl: 'https://...', durationSeconds: 15 } })
  ad: { id: string; title: string; mediaUrl: string; clickUrl: string | null; durationSeconds: number };
}
