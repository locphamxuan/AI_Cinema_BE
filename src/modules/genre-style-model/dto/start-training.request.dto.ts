import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartTrainingRequestDto {
  @ApiProperty({
    example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    description: 'UUID of the Content Reviewer triggering training.',
  })
  @IsUUID()
  triggeredById: string;
}
