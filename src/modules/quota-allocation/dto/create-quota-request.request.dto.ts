import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateQuotaRequestRequestDto {
  @ApiProperty({ example: 800, description: 'Extra AI tokens the Creator asks for on top of the current quota.' })
  @IsInt()
  @Min(1)
  requestedAmount: number;

  @ApiProperty({
    example: 'Cảnh 3 phải sinh lại nhiều lần do khẩu hình chưa khớp.',
    description: 'Why the current quota is not enough.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
