import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class SendSupportMessageRequestDto {
  @ApiProperty({ example: 'Số dư Coin của tôi đang bị sai, kiểm tra giúp mình.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({ description: 'Client-generated id; a retry with the same id returns the first result' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientMessageId?: string;
}
