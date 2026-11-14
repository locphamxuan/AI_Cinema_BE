import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class PeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Calendar month in Vietnam; last month when omitted' })
  @IsOptional()
  @Matches(PERIOD, { message: 'period must be YYYY-MM' })
  period?: string;
}

export class ReviewTransactionFlagRequestDto {
  @ApiProperty({ enum: ['CONFIRMED', 'DISMISSED'], description: 'CONFIRMED = rủi ro thật, DISMISSED = bình thường' })
  @IsIn(['CONFIRMED', 'DISMISSED'])
  decision: 'CONFIRMED' | 'DISMISSED';

  @ApiPropertyOptional({ example: 'Đã liên hệ Member, giao dịch hợp lệ.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
