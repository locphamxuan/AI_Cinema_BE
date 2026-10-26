import { ApiProperty } from '@nestjs/swagger';

class EpisodeAdSlotAdDto {
  @ApiProperty({ example: 'a1...' })
  id: string;

  @ApiProperty({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  title: string;
}

export class EpisodeAdSlotViewDto {
  @ApiProperty({ example: 's1...' })
  id: string;

  @ApiProperty({ example: 420 })
  positionSeconds: number;

  @ApiProperty({ type: EpisodeAdSlotAdDto, nullable: true, description: 'null = weighted draw' })
  ad: EpisodeAdSlotAdDto | null;
}

export class EpisodeAdSlotsViewDto {
  @ApiProperty({ example: 'e1...' })
  episodeId: string;

  @ApiProperty({ example: 1320, nullable: true, description: 'Length of the approved version' })
  durationSeconds: number | null;

  @ApiProperty({
    example: 'MANUAL',
    enum: ['MANUAL', 'RANDOM'],
    description: 'RANDOM: no cue placed, the episode gets adMaxBreaksPerEpisode random cues',
  })
  mode: 'MANUAL' | 'RANDOM';

  @ApiProperty({ type: [EpisodeAdSlotViewDto] })
  slots: EpisodeAdSlotViewDto[];
}
