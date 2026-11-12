import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { WatchRoomService } from './watch-room.service';
import {
  CreateWatchRoomDto,
  JoinByCodeDto,
  LeaveWatchRoomDto,
  UpdateWatchRoomDto,
  WatchRoomResponseDto,
} from './dto/watch-room.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('watch-rooms')
@ApiBearerAuth()
// 2026-11-13: watch rooms and friends are a Member feature only.
@RequirePermission(PERMISSION.WATCH_PARTY)
@Controller('watch-rooms')
export class WatchRoomController {
  constructor(private readonly rooms: WatchRoomService) {}

  @Post()
  @ApiOperation({ summary: 'Create a watch room for an episode; the Host passes the paywall gate too (BR-69)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWatchRoomDto) {
    return this.rooms.create(user.id, dto);
  }

  @Post('join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join by the invite code; wrong guesses are rate-limited (edge 4.1)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  joinByCode(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinByCodeDto) {
    return this.rooms.joinByCode(user.id, dto.roomCode);
  }

  @Post(':roomId/join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join by id (deep link); every gate of the room door applies (edges 1.1–7.3)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  join(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string) {
    return this.rooms.join(user.id, roomId);
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Room state: who is in, the Host clock extrapolated to now, the status' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string) {
    return this.rooms.detail(user.id, roomId);
  }

  @Put(':roomId')
  @ApiOperation({ summary: 'Host updates the playback clock and state (PLAYING / PAUSED / ENDED)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  update(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string, @Body() dto: UpdateWatchRoomDto) {
    return this.rooms.hostSync(user.id, roomId, dto);
  }

  @Post(':roomId/next-episode')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host moves the room to the next episode; every member is re-gated (edges 1.2, 3.5)' })
  @ApiOkResponse({ type: WatchRoomResponseDto })
  async nextEpisode(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string) {
    const { room, blockedUserIds } = await this.rooms.nextEpisode(user.id, roomId);
    return { ...room, blockedUserIds };
  }

  @Post(':roomId/leave')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Leave; a Host chooses TRANSFER or DISBAND, else the earliest member takes over (edge 3.2)',
  })
  leave(@CurrentUser() user: AuthenticatedUser, @Param('roomId', ID) roomId: string, @Body() dto: LeaveWatchRoomDto) {
    return this.rooms.leave(user.id, roomId, dto);
  }
}
