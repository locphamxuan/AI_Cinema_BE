import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { WatchRoomService } from './watch-room.service';
import {
  CreateWatchRoomDto,
  JoinWatchRoomDto,
  UpdateWatchRoomDto,
  WatchRoomResponseDto,
} from './dto/watch-room.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('watch-rooms')
@Controller('watch-rooms')
export class WatchRoomController {
  constructor(private readonly rooms: WatchRoomService) {}

  @Post()
  @ApiOperation({ summary: 'Create a watch room for an episode (BR-69)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWatchRoomDto) {
    return this.rooms.create(user.id, dto);
  }

  @Post(':roomId/join')
  @ApiOperation({ summary: 'Join a room by room code; entitlement is checked before the stream is handed out' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  join(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string, @Body() dto?: JoinWatchRoomDto) {
    return this.rooms.join(user.id, roomId, dto);
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Room state: who is in, the Host clock, the status' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string) {
    return this.rooms.detail(user.id, roomId);
  }

  @Put(':roomId')
  @ApiOperation({ summary: 'Host updates the playback clock and state (PLAYING / PAUSED)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('roomId', ID) roomId: string,
    @Body() dto: UpdateWatchRoomDto,
  ) {
    return this.rooms.hostSync(user.id, roomId, dto);
  }

  @Post(':roomId/leave')
  @ApiOperation({ summary: 'Leave the room; the room is disbanded when the Host leaves' })
  @ApiOkResponse({ type: Boolean })
  leave(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string) {
    return this.rooms.leave(user.id, roomId).then(() => true);
  }
}