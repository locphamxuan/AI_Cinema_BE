import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateRewardRuleRequestDto } from './create-reward-rule.request.dto';

/** Edits a rung; the code stays as it was created. */
export class UpdateRewardRuleRequestDto extends PartialType(OmitType(CreateRewardRuleRequestDto, ['code'] as const)) {
  @ApiPropertyOptional({ description: 'Switch the day off (false) or back on (true)' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
