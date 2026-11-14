import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class StaffReplySupportCaseRequestDto {
  @ApiProperty({ example: '' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({ description: 'Staff-only note the member never sees', default: false })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
