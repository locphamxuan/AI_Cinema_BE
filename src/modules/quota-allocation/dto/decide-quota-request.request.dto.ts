import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveQuotaRequestRequestDto {
  @ApiPropertyOptional({
    example: 600,
    description: 'Tokens actually granted; defaults to the amount the Creator asked for.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  approvedAmount?: number;

  @ApiPropertyOptional({ example: 'Cấp 600 token, tối ưu prompt để tránh sinh lại.' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;
}

export class RejectQuotaRequestRequestDto {
  @ApiProperty({
    example: 'Ngân sách dự án đã cạn, hãy rút gọn cảnh 4.',
    description: 'Why the request is turned down.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}
