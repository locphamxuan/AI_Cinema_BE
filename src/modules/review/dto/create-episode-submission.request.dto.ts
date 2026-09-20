import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEpisodeSubmissionRequestDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Creator submitting the episode.',
  })
  @IsUUID()
  submittedById: string;

  @ApiPropertyOptional({ example: 'Toàn bộ phân cảnh đã hoàn thành', description: 'Optional note for the submission.' })
  @IsString()
  @IsOptional()
  note?: string;
}
