import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { SubscriptionService } from './subscription.service';
import { SubscriptionView } from 'src/modules/episode-access/subscription/dto/subscription-view.dto';
import { SubscriptionIntentView } from 'src/modules/episode-access/subscription/dto/subscription-intent-view.dto';
import { SubscribeRequestDto } from 'src/modules/episode-access/subscription/dto/subscribe.request.dto';
import { SubscriptionActivationView } from 'src/modules/episode-access/subscription/dto/subscription-activation-view.dto';

const ID = new ParseUUIDPipe({ version: '4' });

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
