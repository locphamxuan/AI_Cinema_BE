import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RetryGenerationJobRequestDto {
  @ApiPropertyOptional({
    example: 'giảm độ tối, thêm ánh đèn neon',
    description: 'Revised prompt for the new attempt. Defaults to the previous attempt prompt.',
  })
  @IsString()
  @MaxLength(4000)
  @IsOptional()
  prompt?: string;
}
