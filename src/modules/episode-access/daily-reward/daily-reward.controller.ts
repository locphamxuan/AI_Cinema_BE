import { Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { DailyRewardService } from './daily-reward.service';
import { CheckInResultDto } from 'src/modules/episode-access/daily-reward/dto/check-in-result.dto';
import { IdempotencyKey } from 'src/common/decorators/idempotency-key.decorator';

@ApiTags('daily-rewards')
@ApiBearerAuth()
@Controller('daily-rewards')
export class DailyRewardController {
  constructor(private readonly rewards: DailyRewardService) {}

  @Get('status')
  @RequirePermission(PERMISSION.REWARD_CHECKIN)
  @ApiOperation({ summary: 'Has the caller checked in today, the streak and the reward ladder' })
  status(@CurrentUser('id') userId: string) {
    return this.rewards.status(userId);
  }

  @Post('check-in')
  @RequirePermission(PERMISSION.REWARD_CHECKIN)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Sending it twice pays once' })
  @ApiOperation({ summary: 'Claim today reward; one claim per business day' })
  @ApiOkResponse({ type: CheckInResultDto })
  checkIn(@CurrentUser('id') userId: string, @IdempotencyKey() idempotencyKey?: string) {
    return this.rewards.checkIn(userId, idempotencyKey);
  }
}
