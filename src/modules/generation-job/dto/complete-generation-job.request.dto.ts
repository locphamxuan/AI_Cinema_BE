import { IsNumber, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteGenerationJobRequestDto {
  @ApiPropertyOptional({
    example: 320,
    description: 'Resources consumed by the job (deducted from the active quota allocation).',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  resourceCost?: number;
}
