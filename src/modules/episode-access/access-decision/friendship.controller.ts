import { Throttle } from '@nestjs/throttler';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { FriendshipService } from './friendship.service';
import { CreateFriendshipDto, RespondFriendshipDto } from './dto/create-friendship.dto';
import { FriendshipResponseDto } from './dto/friendship-response.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('friends')
// 2026-11-13: watch rooms and friends are a Member feature only.
@RequirePermission(PERMISSION.WATCH_PARTY)
@Controller('friends')
export class FriendshipController {
  constructor(private readonly friendships: FriendshipService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a friend request (BR-69)' })
  @ApiOkResponse({ type: FriendshipResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFriendshipDto) {
    return this.friendships.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my friendships, optionally filtered by status' })
  @ApiOkResponse({ type: [FriendshipResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.friendships.list(user.id);
  }

  @Post(':friendshipId/respond')
  @ApiOperation({ summary: 'Accept or block a friend request' })
  @ApiOkResponse({ type: FriendshipResponseDto })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('friendshipId', ID) friendshipId: string,
    @Body() dto: RespondFriendshipDto,
  ) {
    return this.friendships.respond(user.id, friendshipId, dto.accept);
  }

  @Post(':friendId/block')
  @ApiOperation({ summary: 'Block a friend' })
  @ApiOkResponse({ type: FriendshipResponseDto })
  block(@CurrentUser() user: AuthenticatedUser, @Param('friendId', ID) friendId: string) {
    return this.friendships.block(user.id, friendId);
  }

  @Delete(':friendId/block')
  @ApiOperation({ summary: 'Unblock a friend' })
  @ApiOkResponse({ type: Boolean })
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('friendId', ID) friendId: string) {
    return this.friendships.unblock(user.id, friendId).then(() => true);
  }
}
