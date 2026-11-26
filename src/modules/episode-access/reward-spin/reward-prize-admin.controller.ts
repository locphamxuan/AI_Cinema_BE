import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CreateRewardPrizeRequestDto } from './dto/create-reward-prize.request.dto';
import { SetRewardChancesRequestDto } from './dto/set-reward-chances.request.dto';
import { UpdateRewardPrizeRequestDto } from './dto/update-reward-prize.request.dto';
import { RewardPrizeAdminService } from './reward-prize-admin.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-rewards')
@ApiBearerAuth()
@RequirePermission(PERMISSION.REWARD_RULE_MANAGE)
@Controller('admin/reward-prizes')
export class RewardPrizeAdminController {
  constructor(private readonly prizes: RewardPrizeAdminService) {}

  @Get()
  @ApiOperation({ summary: 'The reward wheel, with each prize chance in basis points (`weight`, 10 000 = 100 %)' })
  list() {
    return this.prizes.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Put a prize on the wheel',
    description: '409 REWARD_WHEEL_NOT_100 when the prizes switched on would not add up to 100 %',
  })
  create(@CurrentUser('id') actorId: string, @Body() dto: CreateRewardPrizeRequestDto) {
    return this.prizes.create(actorId, dto);
  }

  @Put('chances')
  @ApiOperation({
    summary: 'Set the chance of every prize at once: listed prizes are switched on, the others off',
    description: '409 REWARD_WHEEL_NOT_100 unless the listed weights add up to exactly 10 000 (100 %)',
  })
  setChances(@CurrentUser('id') actorId: string, @Body() dto: SetRewardChancesRequestDto) {
    return this.prizes.setChances(actorId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a prize, its chance, or switch it on/off the wheel',
    description: '409 REWARD_WHEEL_NOT_100 when the prizes switched on would no longer add up to 100 %',
  })
  update(@Param('id', ID) id: string, @CurrentUser('id') actorId: string, @Body() dto: UpdateRewardPrizeRequestDto) {
    return this.prizes.update(id, actorId, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a prize for good; past spins keep a copy of what they won',
    description:
      '409 REWARD_WHEEL_NOT_100 for an active prize while others are on (switch it off first), ' +
      'REWARD_PRIZE_LAST_ACTIVE when it is the last active prize and members still hold spins',
  })
  delete(@Param('id', ID) id: string, @CurrentUser('id') actorId: string) {
    return this.prizes.remove(id, actorId);
  }
}
