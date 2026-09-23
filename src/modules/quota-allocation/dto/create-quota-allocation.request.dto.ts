import { IsEnum, IsNumber, Min } from 'class-validator';
import { QuotaAllocationType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateQuotaAllocationRequestDto {
  @ApiProperty({
    example: 'INITIAL',
    description: 'INITIAL can only be created once per plan; TOP_UP can be created multiple times.',
    enum: QuotaAllocationType,
  })
  @IsEnum(QuotaAllocationType)
  allocationType: QuotaAllocationType;

  @ApiProperty({ example: 1500, description: 'Amount of AI quota granted to the plan. Must be > 0.' })
  @IsNumber()
  @Min(0.000001)
  allocatedAmount: number;
}
