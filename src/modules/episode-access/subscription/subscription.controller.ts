import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import {
  AdminSubscriptionFilterDto,
  CancelSubscriptionRequestDto,
  SubscribeRequestDto,
  SubscriptionActivationView,
  SubscriptionIntentView,
  SubscriptionView,
} from '../membership-plan/dto/membership-plan.request.dto';
import { SubscriptionService } from './subscription.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** The Admin list shows which plan and which member a row belongs to. */
const PLAN_OF_SUBSCRIPTION = { id: true, code: true, name: true };
const MEMBER_OF_SUBSCRIPTION = { id: true, fullName: true, email: true };

@ApiTags('membership')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('me')
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiOperation({ summary: 'My running plan, its period, when auto-renew runs next and the cancel deadline' })
  @ApiOkResponse({ type: SubscriptionView })
  me(@CurrentUser('id') userId: string) {
    return this.subscriptions.mine(userId);
  }

  @Get('mine')
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiOperation({ summary: 'Alias of me; kept for older clients', deprecated: true })
  @ApiOkResponse({ type: SubscriptionView })
  mine(@CurrentUser('id') userId: string) {
    return this.subscriptions.mine(userId);
  }

  @Get(':id/cycles')
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiOperation({ summary: 'Billed cycles of one of my subscriptions, oldest first' })
  cycles(@CurrentUser('id') userId: string, @Param('id', ID) subscriptionId: string) {
    return this.subscriptions.cycles(userId, subscriptionId);
  }

  @Post()
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Sending it twice pays once' })
  @ApiOperation({ summary: 'Quote a plan into a PENDING intent; no Coin moves yet' })
  @ApiOkResponse({ type: SubscriptionIntentView })
  subscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: SubscribeRequestDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.subscriptions.subscribe(userId, dto.planId, key);
  }

  @Post(':id/activate')
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Sending it twice charges once' })
  @ApiOperation({ summary: 'Pay the first cycle with Coin and start the period' })
  @ApiOkResponse({ type: SubscriptionActivationView })
  activate(
    @CurrentUser('id') userId: string,
    @Param('id', ID) subscriptionId: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.subscriptions.activate(userId, subscriptionId, key);
  }

  @Post(':id/cancel-auto-renew')
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiOperation({ summary: 'Stop auto-renew; refused after the window, access runs on to period end' })
  cancel(@CurrentUser('id') userId: string, @Param('id', ID) subscriptionId: string) {
    return this.subscriptions.cancelAutoRenew(userId, subscriptionId);
  }

  @Post(':id/resume-auto-renew')
  @RequirePermission(PERMISSION.SUBSCRIPTION_SELF_MANAGE)
  @ApiOperation({ summary: 'Change the mind before the period ends' })
  resume(@CurrentUser('id') userId: string, @Param('id', ID) subscriptionId: string) {
    return this.subscriptions.resumeAutoRenew(userId, subscriptionId);
  }
}

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
  list(@Paginate() query: PaginateQuery, @Query() filter: AdminSubscriptionFilterDto) {
    return paginate(query, this.prisma.subscription, {
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.planId ? { planId: filter.planId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: new Date(filter.from) } : {}),
                ...(filter.to ? { lte: new Date(filter.to) } : {}),
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
