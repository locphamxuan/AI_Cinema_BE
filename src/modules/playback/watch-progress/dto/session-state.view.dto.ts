import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({
    example: false,
    description:
      'Server-decided: true only when the position reached episodeCompletionPercent, not merely because complete was called.',
  })
  completed: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Heartbeat only: the ad break the playhead passed without playing it (e.g. a forward seek). The player must play it now.',
  })
  dueAdBreakId: string | null;
}
