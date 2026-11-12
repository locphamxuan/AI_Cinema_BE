import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FriendshipResponseDto {
  @ApiPropertyOptional({ description: 'The other member of the friendship (in a list)' })
  friend?: { id: string; fullName: string };

  @ApiPropertyOptional({ description: 'True when the viewer received this request' })
  incoming?: boolean;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  id: string;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  senderId: string;

  @ApiProperty({ example: '3a71f0d4-9c22-4c6b-8f31-1a2b3c4d5e6f' })
  receiverId: string;

  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'ACCEPTED', 'BLOCKED'] })
  status: string;

  @ApiProperty({ example: null, nullable: true })
  respondedAt: string | null;

  @ApiProperty({ example: null, nullable: true })
  lastInviteAt: string | null;

  @ApiProperty({ example: '2026-11-11T00:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-11T00:00:00.000Z' })
  updatedAt: string;

  constructor(partial: Partial<FriendshipResponseDto>) {
    Object.assign(this, partial);
  }

  static from(
    row: {
      id: string;
      senderId: string;
      receiverId: string;
      status: { toString(): string };
      respondedAt: Date | null;
      lastInviteAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      sender?: { id: string; fullName: string | null };
      receiver?: { id: string; fullName: string | null };
    },
    viewerId?: string,
  ): FriendshipResponseDto {
    // The other person, named, for the friends list of `viewerId`.
    const other =
      viewerId && row.sender && row.receiver ? (row.senderId === viewerId ? row.receiver : row.sender) : null;
    return new FriendshipResponseDto({
      friend: other ? { id: other.id, fullName: other.fullName ?? '' } : undefined,
      incoming: viewerId ? row.receiverId === viewerId : undefined,
      id: row.id,
      senderId: row.senderId,
      receiverId: row.receiverId,
      status: row.status.toString(),
      respondedAt: row.respondedAt?.toISOString() ?? null,
      lastInviteAt: row.lastInviteAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
