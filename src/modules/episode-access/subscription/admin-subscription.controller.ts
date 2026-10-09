import { Paginate, type PaginateQuery, paginate } from '@nestarc/pagination';
import { Controller, Get, Param, Post, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AdminSubscriptionQueryDto } from 'src/modules/episode-access/subscription/dto/admin-subscription.query.dto';
import { CancelSubscriptionRequestDto } from 'src/modules/episode-access/subscription/dto/cancel-subscription.request.dto';
import { SubscriptionService } from 'src/modules/episode-access/subscription/subscription.service';

/** The Admin list shows which plan and which member a row belongs to. */
const PLAN_OF_SUBSCRIPTION = { id: true, code: true, name: true };
const MEMBER_OF_SUBSCRIPTION = { id: true, fullName: true, email: true };

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-subscriptions')
@ApiBearerAuth()
@Controller('admin/subscriptions')
export class AdminSubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION.BILLING_SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Every subscription; filter by status, plan, member or date range' })
  list(@Paginate() paginateQuery: PaginateQuery, @Query() query: AdminSubscriptionQueryDto) {
    return paginate(paginateQuery, this.prisma.subscription, {
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.planId ? { planId: query.planId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      relations: { plan: { select: PLAN_OF_SUBSCRIPTION }, user: { select: MEMBER_OF_SUBSCRIPTION } },
      sortableColumns: ['createdAt', 'currentPeriodEnd', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'], planId: ['$eq'], userId: ['$eq'] },
    });
  }

  @Get(':id')
  @RequirePermission(PERMISSION.BILLING_SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'One subscription with its billing cycles' })
  detail(@Param('id', ID) id: string) {
    return this.subscriptions.detail(id);
  }

  @Post(':id/cancel')
  @RequirePermission(PERMISSION.BILLING_SUBSCRIPTION_CANCEL)
  @ApiOperation({ summary: 'End a member plan with Admin rights' })
  cancel(@Param('id', ID) id: string, @CurrentUser('id') actorId: string, @Body() dto: CancelSubscriptionRequestDto) {
    return this.subscriptions.cancelByAdmin(id, actorId, dto.reason);
  }
}
