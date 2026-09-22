import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PlanReviewStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DecidePlanReviewRequestDto {
  @ApiProperty({
    example: 'APPROVED',
    description: 'Per-scene decision of the Content Reviewer.',
    enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
  })
  @IsEnum(PlanReviewStatus)
  decision: PlanReviewStatus;

  @ApiPropertyOptional({ example: 'Phân cảnh hợp lệ về thời lượng.', description: 'Comments of the reviewer.' })
  @IsString()
  @IsOptional()
  comments?: string;

  @ApiPropertyOptional({
    example: 'Thời lượng dài hơn dự kiến, cần cắt giảm.',
    description: 'Reason used for CHANGES_REQUESTED/REJECTED decisions.',
  })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
