import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

export const FLAG_DECISIONS = ['ACCOUNT_LOCKED', 'DISMISSED'] as const;
export type FlagDecision = (typeof FLAG_DECISIONS)[number];

export class ReviewTransactionFlagRequestDto {
  @ApiProperty({
    enum: FLAG_DECISIONS,
    description: 'ACCOUNT_LOCKED = khoá tài khoản Member và đăng xuất mọi phiên, DISMISSED = giao dịch bình thường',
  })
  @IsIn(FLAG_DECISIONS)
  decision: FlagDecision;

  @ApiPropertyOptional({
    example: 'Nạp lớn bất thường, đã báo bộ phận thanh toán.',
    description: 'Lý do; bắt buộc khi khoá tài khoản',
  })
  @Trim()
  // Required to lock; an empty note on a dismissal simply means none.
  @ValidateIf((dto: ReviewTransactionFlagRequestDto) => dto.decision === 'ACCOUNT_LOCKED' || Boolean(dto.note))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note?: string;
}
