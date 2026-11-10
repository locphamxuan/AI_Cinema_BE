import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { MEMBER_CONTEXT_SECTIONS, type MemberContextSection } from './member-context.service';
import { StaffSupportService } from './staff-support.service';
import { AssignSupportCaseRequestDto } from 'src/modules/support/staff/dto/assign-support-case.request.dto';
import { ResolveSupportCaseRequestDto } from 'src/modules/support/staff/dto/resolve-support-case.request.dto';
import { StaffReplySupportCaseRequestDto } from 'src/modules/support/staff/dto/staff-reply-support-case.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Staff and Admin portal: the support queue (plan §6.2). */
@ApiTags('support-admin')
@ApiBearerAuth()
@Controller('admin/support')
export class StaffSupportController {
  constructor(private readonly staff: StaffSupportService) {}

  @Get('conversations')
  @RequirePermission(PERMISSION.SUPPORT_CASE_READ)
  @ApiOperation({ summary: 'The support queue, filterable by status, priority and assignee' })
  list(@Paginate() query: PaginateQuery) {
    return this.staff.list(query);
  }

  // Declared before ':id' routes; this is a literal sibling of 'conversations'.
  @Get('stats')
  @RequirePermission(PERMISSION.SUPPORT_CASE_READ)
  @ApiOperation({ summary: 'Queue depth, waiting time, today’s escalations and the AI resolution rate' })
  stats() {
    return this.staff.stats();
  }

  @Get('conversations/:id')
  @RequirePermission(PERMISSION.SUPPORT_CASE_READ)
  @ApiOperation({ summary: 'One case with its transcript, internal notes included' })
  detail(@Param('id', ID) id: string) {
    return this.staff.detail(id);
  }

  @Get('conversations/:id/member-context')
  @RequirePermission(PERMISSION.SUPPORT_CASE_READ)
  @ApiOperation({ summary: 'Member snapshot; each section is gated by its own permission' })
  memberContext(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID) id: string,
    @Query('section') section?: string,
  ) {
    return this.staff.getMemberContext(id, user, parseSection(section));
  }

  @Post('conversations/:id/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CASE_MANAGE)
  @ApiOperation({ summary: 'Claim a case waiting for Staff' })
  claim(@CurrentUser('id') staffId: string, @Param('id', ID) id: string) {
    return this.staff.claim(id, staffId);
  }

  @Post('conversations/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CASE_MANAGE)
  @ApiOperation({ summary: 'Return a case to the queue' })
  release(@CurrentUser() user: AuthenticatedUser, @Param('id', ID) id: string) {
    return this.staff.release(id, user);
  }

  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CASE_MANAGE)
  @ApiOperation({ summary: 'Reply to the member, or leave an internal note' })
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID) id: string,
    @Body() dto?: StaffReplySupportCaseRequestDto,
  ) {
    return this.staff.reply(id, user, dto ?? {});
  }

  @Post('conversations/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CASE_MANAGE)
  @ApiOperation({ summary: 'Mark the case resolved' })
  resolve(@CurrentUser('id') staffId: string, @Param('id', ID) id: string, @Body() dto?: ResolveSupportCaseRequestDto) {
    return this.staff.resolve(id, staffId, dto?.note);
  }

  @Post('conversations/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CASE_MANAGE)
  @ApiOperation({ summary: 'Close the case; the transcript stays readable' })
  close(@CurrentUser('id') staffId: string, @Param('id', ID) id: string, @Body() dto?: ResolveSupportCaseRequestDto) {
    return this.staff.close(id, staffId, dto?.note);
  }

  @Post('conversations/:id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSION.SUPPORT_CASE_ASSIGN)
  @ApiOperation({ summary: 'Assign the case to a Staff member (Admin)' })
  assign(@CurrentUser('id') adminId: string, @Param('id', ID) id: string, @Body() dto: AssignSupportCaseRequestDto) {
    return this.staff.assign(id, dto.staffId, adminId);
  }
}

function parseSection(section?: string): MemberContextSection | undefined {
  if (!section) return undefined;
  if (!MEMBER_CONTEXT_SECTIONS.includes(section as MemberContextSection)) {
    throw new BadRequestException(`section must be one of ${MEMBER_CONTEXT_SECTIONS.join(', ')}`);
  }
  return section as MemberContextSection;
}
