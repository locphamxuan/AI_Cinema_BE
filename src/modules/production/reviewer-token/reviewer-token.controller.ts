import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AddReviewerTokenEntryRequestDto } from './dto/reviewer-token.request.dto';
import { ReviewerTokenService } from './reviewer-token.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('reviewer-tokens')
@ApiBearerAuth()
@Controller('reviewer-tokens')
export class ReviewerTokenController {
  constructor(private readonly budgets: ReviewerTokenService) {}

  @Get('me')
  @RequirePermission(PERMISSION.PROJECT_FEE_ALLOCATE)
  @ApiOperation({ summary: "The signed-in Reviewer's Token: granted, allocated to projects, left, and the history" })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.budgets.wallet(user.id);
  }
}

@ApiTags('reviewer-tokens')
@ApiBearerAuth()
@RequirePermission(PERMISSION.TOKEN_BUDGET_MANAGE)
@Controller('admin/reviewer-tokens')
export class AdminReviewerTokenController {
  constructor(private readonly budgets: ReviewerTokenService) {}

  @Get()
  @ApiOperation({ summary: 'Every Reviewer with the Token granted, allocated and left' })
  reviewers() {
    return this.budgets.reviewers();
  }

  @Get(':reviewerId')
  wallet(@Param('reviewerId', ID) reviewerId: string) {
    return this.budgets.wallet(reviewerId);
  }

  @Post(':reviewerId/entries')
  @ApiOperation({ summary: 'Grant Token to a Reviewer, or take back part of what is left (reason required)' })
  addEntry(
    @Param('reviewerId', ID) reviewerId: string,
    @Body() dto: AddReviewerTokenEntryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budgets.addEntry(reviewerId, dto, user);
  }
}
