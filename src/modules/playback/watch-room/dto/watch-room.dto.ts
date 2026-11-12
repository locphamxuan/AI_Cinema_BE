import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { formatRoomCode } from '../room-codes';

export class CreateWatchRoomDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  @IsUUID('4')
  episodeId: string;
}

export class JoinByCodeDto {
  @ApiProperty({ example: 'AB2-CD9', description: 'The code on the invite; case and dashes do not matter' })
  @IsString()
  @Length(4, 16)
  roomCode: string;
}

export class UpdateWatchRoomDto {
  @ApiProperty({ enum: ['PLAYING', 'PAUSED', 'ENDED'] })
  @IsIn(['PLAYING', 'PAUSED', 'ENDED'])
  state: 'PLAYING' | 'PAUSED' | 'ENDED';

  @ApiProperty({ example: 120, description: 'Host clock, seconds from the episode start' })
  @IsNumber()
  @Min(0)
  positionSeconds: number;
}

/** Edge 3.2 — what a leaving Host wants for the room: hand it over, or close it for everyone. */
export class LeaveWatchRoomDto {
  @ApiPropertyOptional({ enum: ['TRANSFER', 'DISBAND'], description: 'Only read when the Host leaves' })
  @IsIn(['TRANSFER', 'DISBAND'])
  @IsOptional()
  action?: 'TRANSFER' | 'DISBAND';

  @ApiPropertyOptional({ description: 'With TRANSFER: the member to promote; omit for the earliest one' })
  @IsUUID('4')
  @IsOptional()
  newHostUserId?: string;
}

export class WatchRoomResponseDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  id: string;

  @ApiProperty({ example: 'AB2-CD9' })
  roomCode: string;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;

  @ApiPropertyOptional({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  hostUserId: string | null;

  @ApiProperty({ enum: ['CREATED', 'WAITING_FOR_PARTICIPANTS', 'PLAYING', 'PAUSED', 'ENDED', 'DISBANDED'] })
  status: string;

  @ApiProperty({ example: 930.5, description: 'Extrapolated to now while the room is PLAYING (edge 2.1)' })
  currentPositionSeconds: number;

  @ApiPropertyOptional({ example: 2 })
  participantCount?: number;

  @ApiPropertyOptional({ example: 1767000000000, description: 'Server clock at the snapshot, ms since epoch' })
  serverTimestamp?: number;

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
      roomCode: formatRoomCode(room.roomCode),
      episodeId: room.episodeId,
      hostUserId: room.hostUserId,
      status: room.status.toString(),
      currentPositionSeconds: room.currentPositionSeconds,
      participantCount,
    });
  }
}
