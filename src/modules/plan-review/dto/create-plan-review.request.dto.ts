import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanReviewRequestDto {
  @ApiPropertyOptional({
    example: ['b1c2d3e4-f5a6-7890-bcde-f12345678901'],
    description: 'Scenes to review. Defaults to all scenes of the plan. One PlanReview row is created per scene.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  sceneIds?: string[];

  @ApiPropertyOptional({
    example: 'Kiểm tra độ dài và nội dung từng phân cảnh.',
    description: 'General comments of the review round.',
  })
  @IsString()
  @IsOptional()
  comments?: string;
}
