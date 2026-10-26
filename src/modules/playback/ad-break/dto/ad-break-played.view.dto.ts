import { ApiProperty } from '@nestjs/swagger';

/** What starting or completing a break hands back; the start response is the impression record. */
export class AdBreakPlayedViewDto {
  @ApiProperty({ example: 'c31d...' })
  breakId: string;

  @ApiProperty({ example: 'COMPLETED', enum: ['PENDING', 'COMPLETED', 'SKIPPED'] })
  status: string;

  @ApiProperty({ example: '2026-10-15T10:00:00.000Z', nullable: true })
  playedAt: Date | null;

  @ApiProperty({
    example: false,
    description:
      'True only after the player confirms the ad played to the end; starting the ad alone does not count as a completed view.',
  })
  completedView: boolean;
}
