import { ApiProperty } from '@nestjs/swagger';

export class UpdateWatchRoomDto {
  @ApiProperty({ enum: ['PLAYING', 'PAUSED', 'ENDED'] })
  state: 'PLAYING' | 'PAUSED' | 'ENDED';

  @ApiProperty({ example: 120, description: 'Host clock, seconds from the episode start' })
  positionSeconds: number;
}