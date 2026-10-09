import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ChangeRequestService } from './change-request.service';
import { ProposeChangeRequestDto, ResolveChangeRequestDto } from './dto/change-request.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** BR-55, §4.1.8: Admin proposals and the Reviewer's answers. */
@ApiTags('movie-projects')
@ApiBearerAuth()
@Controller()
export class ChangeRequestController {
  constructor(private readonly changeRequests: ChangeRequestService) {}

  @Post('projects/:movieId/change-requests')
  @RequirePermission(PERMISSION.PROJECT_SUGGEST)
  @ApiOperation({ summary: 'Propose a change to a project (Admin); the Reviewer is notified' })
  propose(
    @Param('movieId', ID) movieId: string,
    @Body() dto: ProposeChangeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.propose(movieId, dto, user);
  }

  @Get('projects/:movieId/change-requests')
  list(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.changeRequests.list(movieId, user);
  }

  @Post('change-requests/:changeRequestId/accept')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Accept a proposal after making the change yourself' })
  accept(
    @Param('changeRequestId', ID) changeRequestId: string,
    @Body() dto: ResolveChangeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.resolve(changeRequestId, true, dto, user);
  }

  @Post('change-requests/:changeRequestId/reject')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Reject a proposal, with the reason' })
  reject(
    @Param('changeRequestId', ID) changeRequestId: string,
    @Body() dto: ResolveChangeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.resolve(changeRequestId, false, dto, user);
  }
}
