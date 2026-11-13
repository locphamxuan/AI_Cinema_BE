import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveSupportCaseRequestDto {
  @ApiPropertyOptional({ example: 'Đã hoàn Coin và xác nhận với thành viên.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
