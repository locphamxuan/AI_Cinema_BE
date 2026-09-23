import { IsOptional, IsString, IsUUID } from 'class-validator';
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
