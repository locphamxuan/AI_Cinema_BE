import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { BlankAsNull } from 'src/common/validation/trim';

export class ResolveSupportCaseRequestDto {
  @ApiPropertyOptional({ example: 'Đã hoàn Coin và xác nhận với thành viên.' })
  @BlankAsNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
