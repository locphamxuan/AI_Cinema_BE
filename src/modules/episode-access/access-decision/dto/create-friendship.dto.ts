import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsUUID, ValidateIf, ValidateNested } from 'class-validator';

export class FriendInviteContextDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  @IsUUID('4')
  roomId: string;
}

export class CreateFriendshipDto {
  /** The friend's id (from a list); or give receiverEmail when the member only knows the email. */
  @ApiPropertyOptional({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  @ValidateIf((dto: CreateFriendshipDto) => !dto.receiverEmail)
  @IsUUID('4')
  receiverId?: string;

  @ApiPropertyOptional({ example: 'ban.cua.toi@gmail.com' })
  @ValidateIf((dto: CreateFriendshipDto) => !dto.receiverId)
  @IsEmail()
  receiverEmail?: string;

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
