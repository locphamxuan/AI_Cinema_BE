import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ReviewStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewRequestDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'UUID of the Content Reviewer.' })
  @IsUUID()
  reviewerId: string;

  @ApiPropertyOptional({
    description: 'Final-episode submission this review round belongs to. Defaults to the latest EPISODE submission.',
  })
  @IsUUID()
  @IsOptional()
  submissionId?: string;

  @ApiPropertyOptional({
    example: 'Kiểm tra chất lượng tổng thể của tập phim.',
    description: 'Opening comments of the review round.',
  })
  @IsString()
  @IsOptional()
  comments?: string;
}

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
