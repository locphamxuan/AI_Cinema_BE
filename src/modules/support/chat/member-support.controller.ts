import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { SupportChatService } from './support-chat.service';
import {
  CloseSupportConversationRequestDto,
  ConfirmResolvedSupportCaseRequestDto,
  RequestStaffRequestDto,
  SendSupportMessageRequestDto,
} from '../dto/support-requests.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Member app: the member's own support case (plan §6.1). */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support/conversations')
export class MemberSupportController {
  constructor(private readonly chat: SupportChatService) {}

  @Post()
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'Open a support case, or return the one already open' })
  start(@CurrentUser('id') memberId: string) {
    return this.chat.start(memberId);
  }

  @Get()
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'My support history' })
  listMine(@CurrentUser('id') memberId: string, @Paginate() query: PaginateQuery) {
    return this.chat.listMine(memberId, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'One of my cases with its latest messages' })
  detail(@CurrentUser('id') memberId: string, @Param('id', ID) id: string) {
    return this.chat.detail(memberId, id);
  }

  @Get(':id/messages')
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'Older messages, cursor-paged with `before`' })
  messages(
    @CurrentUser('id') memberId: string,
    @Param('id', ID) id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.listMessages(memberId, id, before, limit ? Number(limit) : undefined);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a message; the AI answers while the case is AI_HANDLING' })
  send(@CurrentUser('id') memberId: string, @Param('id', ID) id: string, @Body() dto?: SendSupportMessageRequestDto) {
    return this.chat.send(memberId, id, dto ?? {});
  }

  @Post(':id/confirm-resolved')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'Confirm the AI solved it: the server closes the case' })
  confirmResolved(
    @CurrentUser('id') memberId: string,
    @Param('id', ID) id: string,
    @Body() dto?: ConfirmResolvedSupportCaseRequestDto,
  ) {
    return this.chat.confirmResolved(memberId, id, dto?.rating, dto?.comment);
  }

  @Post(':id/request-staff')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'Ask for a human; the case moves to WAITING_FOR_STAFF' })
  requestStaff(@CurrentUser('id') memberId: string, @Param('id', ID) id: string, @Body() dto?: RequestStaffRequestDto) {
    return this.chat.requestStaff(memberId, id, dto?.note);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'Close my own case' })
  close(
    @CurrentUser('id') memberId: string,
    @Param('id', ID) id: string,
    @Body() dto?: CloseSupportConversationRequestDto,
  ) {
    return this.chat.close(memberId, id, dto?.note);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION.SUPPORT_CHAT)
  @ApiOperation({ summary: 'Mark the case read' })
  read(@CurrentUser('id') memberId: string, @Param('id', ID) id: string) {
    return this.chat.markRead(memberId, id);
  }
}
