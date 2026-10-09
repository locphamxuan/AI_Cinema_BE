import { PartialType } from '@nestjs/swagger';
import { CreateRewardRuleRequestDto } from 'src/modules/episode-access/daily-reward/dto/create-reward-rule.request.dto';

export class UpdateRewardRuleRequestDto extends PartialType(CreateRewardRuleRequestDto) {}
