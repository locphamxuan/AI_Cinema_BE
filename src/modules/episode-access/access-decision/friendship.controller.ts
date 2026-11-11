import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { FriendshipService } from './friendship.service';
import { CreateFriendshipDto } from './dto/create-friendship.dto';
import { FriendshipResponseDto } from './dto/friendship-response.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('friends')
@Controller('friends')
export class FriendshipController {
  constructor(private readonly friendships: FriendshipService) {}

  @Post()
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
    @Body('accept') accept: boolean,
  ) {
    return this.friendships.respond(user.id, friendshipId, accept);
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
