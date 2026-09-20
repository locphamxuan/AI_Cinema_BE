import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelProductionProjectRequestDto {
  @ApiPropertyOptional({ example: 'Out of budget', description: 'Reason for cancelling the production project.' })
  @IsString()
  @IsOptional()
  reason?: string;
}
