import { ApiProperty } from '@nestjs/swagger';

/** What marking a break played hands back; doubles as the impression record. */
export class AdBreakPlayedViewDto {
  @ApiProperty({ example: 'c31d...' })
  breakId: string;

  @ApiProperty({ example: 'PLAYED' })
  status: string;

  @ApiProperty({ example: '2026-10-15T10:00:00.000Z', nullable: true })
  playedAt: Date | null;
}
