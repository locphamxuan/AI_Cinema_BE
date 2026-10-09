import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { PERMISSION } from 'src/common/auth/permissions';
import { RewardRuleAdminService } from './reward-rule-admin.service';
import { CreateRewardRuleRequestDto } from 'src/modules/episode-access/daily-reward/dto/create-reward-rule.request.dto';
import { UpdateRewardRuleRequestDto } from 'src/modules/episode-access/daily-reward/dto/update-reward-rule.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-rewards')
@ApiBearerAuth()
@RequirePermission(PERMISSION.REWARD_RULE_MANAGE)
@Controller('admin/reward-rules')
export class RewardRuleAdminController {
  constructor(private readonly rewardRuleAdminService: RewardRuleAdminService) {}

  @Get()
  @ApiOperation({ summary: 'The streak ladder' })
  list() {
    return this.rewardRuleAdminService.list();
  }

  @Post()
  @ApiOperation({ summary: 'Add a rung of the ladder' })
  create(@CurrentUser('id') actorId: string, @Body() dto: CreateRewardRuleRequestDto) {
    return this.rewardRuleAdminService.create(actorId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a rung, including switching a day off' })
  @ApiOkResponse()
  update(
    @Param('id', ID) id: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: UpdateRewardRuleRequestDto & { isActive?: boolean },
  ) {
    return this.rewardRuleAdminService.update(id, actorId, dto);
  }
}
