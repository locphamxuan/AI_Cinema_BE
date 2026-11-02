import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

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

export class RequestStaffRequestDto {
  @ApiPropertyOptional({ example: 'Mình đã thử nạp lại nhưng Coin vẫn chưa vào.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CloseSupportConversationRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ConfirmResolvedSupportCaseRequestDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class StaffReplySupportCaseRequestDto {
  @ApiProperty({ example: 'Mình đã kiểm tra giao dịch và hoàn lại Coin cho bạn.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({ description: 'Staff-only note the member never sees', default: false })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class ResolveSupportCaseRequestDto {
  @ApiPropertyOptional({ example: 'Đã hoàn Coin và xác nhận với thành viên.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AssignSupportCaseRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  staffId: string;
}
