import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import {
  ApproveTokenRequestDto,
  CreateTokenRequestDto,
  RejectTokenRequestDto,
  TokenRequestListQueryDto,
} from './dto/token-request.request.dto';
import { TokenRequestService } from './token-request.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** A Creator asks the Reviewer for more production-fee Token; the Reviewer answers. */
@ApiTags('token-requests')
@ApiBearerAuth()
@Controller()
export class TokenRequestController {
  constructor(private readonly requests: TokenRequestService) {}

  @Post('projects/:movieId/token-requests')
  @RequirePermission(PERMISSION.PROJECT_SUGGEST)
  @ApiOperation({ summary: 'Creator: ask the Reviewer for more Token for a season' })
  create(
    @Param('movieId', ID) movieId: string,
    @Body() dto: CreateTokenRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.create(movieId, dto, user);
  }

  @Get('projects/:movieId/token-requests')
  listForProject(
    @Param('movieId', ID) movieId: string,
    @Query() query: TokenRequestListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.list(query, user, movieId);
  }

  @Get('token-requests')
  @ApiOperation({ summary: 'Reviewer inbox, the Creator’s own requests, or every request for the Admin to follow' })
  list(@Query() query: TokenRequestListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.list(query, user);
  }

  @Post('token-requests/:requestId/approve')
  @RequirePermission(PERMISSION.PROJECT_FEE_ALLOCATE)
  @ApiOperation({ summary: 'Reviewer: grant the Token out of their own budget as a top-up on the season' })
  approve(
    @Param('requestId', ID) requestId: string,
    @Body() dto: ApproveTokenRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.approve(requestId, dto.grantedTokens, user);
  }

  @Post('token-requests/:requestId/reject')
  @RequirePermission(PERMISSION.PROJECT_FEE_ALLOCATE)
  @ApiOperation({ summary: 'Reviewer: refuse, with the reason' })
  reject(
    @Param('requestId', ID) requestId: string,
    @Body() dto: RejectTokenRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.reject(requestId, dto.response, user);
  }
}
