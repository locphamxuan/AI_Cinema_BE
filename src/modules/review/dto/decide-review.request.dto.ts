import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { IsEnum, IsString, IsOptional } from 'class-validator';

export class DecideReviewRequestDto {
  @ApiProperty({
    example: 'APPROVED',
    description: 'Final decision of the Content Reviewer.',
    enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
  })
  @IsEnum(ReviewStatus)
  decision: ReviewStatus;

  @ApiPropertyOptional({ example: 'Đủ điều kiện phát hành.', description: 'Decision comments.' })
  @IsString()
  @IsOptional()
  comments?: string;

  @ApiPropertyOptional({
    example: 'Thiếu nhạc nền ở phân cảnh 3.',
    description: 'Reason for CHANGES_REQUESTED/REJECTED.',
  })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
