import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID, ValidateNested } from 'class-validator';

export class FriendInviteContextDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  @IsUUID('4')
  roomId: string;
}

export class CreateFriendshipDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  @IsUUID('4')
  receiverId: string;

  /** Set when the sender is inviting the friend into a watch room right away. */
  @ApiPropertyOptional({ type: FriendInviteContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FriendInviteContextDto)
  inviteContext?: FriendInviteContextDto;
}

export class RespondFriendshipDto {
  @ApiProperty({ description: 'true accepts the request, false blocks the sender' })
  @IsBoolean()
  accept: boolean;
}
