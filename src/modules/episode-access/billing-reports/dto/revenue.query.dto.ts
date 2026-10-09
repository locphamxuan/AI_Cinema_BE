import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class RevenueQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Start of the range; 30 days ago when omitted' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'End of the range; now when omitted' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ example: true, description: 'Also return the day-by-day series for the chart' })
  @IsOptional()
  byDay?: boolean;
}
