import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({ example: 'Member asked to leave after the trial', description: 'Why the Admin ended it' })
  @IsString()
  @IsOptional()
  reason?: string;
}
