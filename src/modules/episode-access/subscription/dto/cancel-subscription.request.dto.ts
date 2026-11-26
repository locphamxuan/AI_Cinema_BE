import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({ example: 'Member asked to leave after the trial', description: 'Why the Admin ended it' })
  @Trim()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
