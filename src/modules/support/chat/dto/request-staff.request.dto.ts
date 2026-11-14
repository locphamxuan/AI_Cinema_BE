import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestStaffRequestDto {
  @ApiPropertyOptional({ example: 'Mình đã thử nạp lại nhưng Coin vẫn chưa vào.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
