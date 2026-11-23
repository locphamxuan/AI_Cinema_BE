import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CreateRewardPrizeRequestDto } from './dto/create-reward-prize.request.dto';
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
  @ApiOperation({ summary: 'The reward wheel, with each prize weight' })
  list() {
    return this.prizes.list();
  }

  @Post()
  @ApiOperation({ summary: 'Put a prize on the wheel' })
  create(@CurrentUser('id') actorId: string, @Body() dto: CreateRewardPrizeRequestDto) {
    return this.prizes.create(actorId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a prize, its weight, or switch it on/off the wheel' })
  update(@Param('id', ID) id: string, @CurrentUser('id') actorId: string, @Body() dto: UpdateRewardPrizeRequestDto) {
    return this.prizes.update(id, actorId, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a prize for good; past spins keep a copy of what they won',
    description: '409 REWARD_PRIZE_LAST_ACTIVE when it is the last active prize and members still hold spins',
  })
  delete(@Param('id', ID) id: string, @CurrentUser('id') actorId: string) {
    return this.prizes.remove(id, actorId);
  }
}
