import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitProductionPlanRequestDto {
  @ApiPropertyOptional({ example: 'Kế hoạch đã đầy đủ', description: 'Optional note for the plan submission.' })
  @IsString()
  @IsOptional()
  note?: string;
}
