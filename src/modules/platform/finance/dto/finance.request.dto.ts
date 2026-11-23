import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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
