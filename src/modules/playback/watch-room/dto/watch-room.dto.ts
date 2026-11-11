import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWatchRoomDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;
}

export class JoinWatchRoomDto {
  @ApiPropertyOptional({ example: 'AC-8842', description: 'Room code when joining by code instead of a link' })
  roomCode?: string;
}

export class UpdateWatchRoomDto {
  @ApiProperty({ enum: ['PLAYING', 'PAUSED', 'ENDED'] })
  state: 'PLAYING' | 'PAUSED' | 'ENDED';

  @ApiProperty({ example: 120, description: 'Host clock, seconds from the episode start' })
  positionSeconds: number;
}

export class WatchRoomResponseDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  id: string;

  @ApiProperty({ example: 'AC-8842' })
  roomCode: string;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;

  @ApiPropertyOptional({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  hostUserId: string | null;

  @ApiProperty({ enum: ['CREATED', 'WAITING_FOR_PARTICIPANTS', 'PLAYING', 'PAUSED', 'ENDED', 'DISBANDED'] })
  status: string;

  @ApiProperty({ example: 0 })
  currentPositionSeconds: number;

  @ApiPropertyOptional({ example: 2 })
  participantCount?: number;

  constructor(partial: Partial<WatchRoomResponseDto>) {
    Object.assign(this, partial);
  }

  static from(
    room: {
      id: string;
      roomCode: string;
      episodeId: string;
      hostUserId: string | null;
      status: { toString(): string };
      currentPositionSeconds: number;
    },
    participantCount: number,
  ): WatchRoomResponseDto {
    return new WatchRoomResponseDto({
      id: room.id,
      roomCode: room.roomCode,
      episodeId: room.episodeId,
      hostUserId: room.hostUserId,
      status: room.status.toString(),
      currentPositionSeconds: room.currentPositionSeconds,
      participantCount,
    });
  }
}