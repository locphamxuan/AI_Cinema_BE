import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { IdempotencyKey } from 'src/common/decorators/idempotency-key.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { RewardSpinService } from './reward-spin.service';

@ApiTags('daily-rewards')
@ApiBearerAuth()
@RequirePermission(PERMISSION.REWARD_CHECKIN)
@Controller('rewards/spins')
export class RewardSpinController {
  constructor(private readonly spins: RewardSpinService) {}

  @Get()
  @ApiOperation({ summary: 'Spins left, the prizes on the wheel and my latest results (BR-09)' })
  mine(@CurrentUser('id') userId: string) {
    return this.spins.mine(userId);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Sending it twice spins once' })
  @ApiOperation({ summary: 'Use my oldest spin: draws a prize and pays it out' })
  spin(@CurrentUser('id') userId: string, @IdempotencyKey() idempotencyKey?: string) {
    return this.spins.spin(userId, idempotencyKey);
  }
}
