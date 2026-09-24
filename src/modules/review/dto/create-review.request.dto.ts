import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewRequestDto {
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
